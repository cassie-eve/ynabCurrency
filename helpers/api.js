/* eslint-disable no-unused-vars */
/* eslint-disable camelcase */
const dayjs = require('dayjs');
require('dotenv').config();
// Configuration
const ynabToken = process.env.YNAB_TOKEN;
const ynabBaseUrl = 'https://api.ynab.com/v1';
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const headers = {
  'Authorization': `Bearer ${ynabToken}`,
  'Content-Type': 'application/json',
};

// Storing server knowledge for a budget
const updateServerKnowledge = async(budgetId, serverKnowledge) => {
  try {
    const { data, error } = await supabase
      .from('budgets')
      .upsert({
        id: budgetId, // Assuming 'id' is the primary key
        server_knowledge: serverKnowledge
      }, {
        onConflict: 'id' // Updated to match the primary key
      });

    if (error) throw error;

    console.log(`Server knowledge for ${budgetId} is set to ${serverKnowledge}`);
  } catch (error) {
    console.error('Error updating server knowledge:', error.message);
  }
};


// Retrieving server knowledge for a specific budget
const getServerKnowledge = async(budgetId) => {
  try {
    const { data, error } = await supabase
      .from('budgets')
      .select('server_knowledge')
      .eq('id', budgetId)
      .single();

    if (error) {
      console.error('❌ CRITICAL ERROR:', { message: 'Failed to retrieve server knowledge from Supabase', budgetId, error });
      throw new Error(`Failed to retrieve server knowledge from database: ${error.message}`);
    }

    if (!data) {
      console.error('❌ CRITICAL ERROR:', { message: 'No server knowledge record found', budgetId });
      throw new Error(`No server knowledge found for budget: ${budgetId}`);
    }

    return data.server_knowledge;
  } catch (error) {
    console.error('❌ CRITICAL ERROR:', { message: 'Server knowledge retrieval failed', budgetId, error });
    throw error; // Re-throw the error to stop the process
  }
};


const getTransactions = async(budgetId, accountId, sinceServerKnowledge = null) => {
  const today = dayjs();
  const thirtyDaysAgo = today.subtract(30, 'day').format('YYYY-MM-DD');
  const url = sinceServerKnowledge
    ? `${ynabBaseUrl}/budgets/${budgetId}/accounts/${accountId}/transactions?last_knowledge_of_server=${sinceServerKnowledge}`
    : `${ynabBaseUrl}/budgets/${budgetId}/accounts/${accountId}/transactions?since_date=${thirtyDaysAgo}`;

  console.log(`Fetching transactions from URL: ${url}`);

  const response = await fetch(url, { headers, method: 'GET' });
  const data = await response.json();

  return {
    transactions: data.data.transactions,
    newServerKnowledge: data.data.server_knowledge
  };
};

const searchTransactionsByMemo = async(budgetId, accountId, originalTransactionId) => {
  const today = dayjs();
  let thirtyDaysAgo = today.subtract(30, 'day').format('YYYY-MM-DD');
  
  const url = `${ynabBaseUrl}/budgets/${budgetId}/accounts/${accountId}/transactions?since_date=${thirtyDaysAgo}`;
  console.log(`Searching transactions by memo at URL: ${url}`); // Log the URL being fetched

  const response = await fetch(url, { headers, method: 'GET' });
  const data = await response.json();

  if (!response.ok || !data || !data.data || !data.data.transactions) {
    console.error('Error fetching transactions or invalid response format:', data);
    return []; // Return empty array in case of error or unexpected response format
  }

  const filteredTransactions = data.data.transactions.filter(transaction =>
    transaction.memo && transaction.memo.includes(originalTransactionId)
  );

  return filteredTransactions;
};


const deleteTransaction = async(budgetId, transactionId) => {
  const url = `${ynabBaseUrl}/budgets/${budgetId}/transactions/${transactionId}`;
  const response = await fetch(url, {
    headers,
    method: 'DELETE'
  });
  const data = await response.json();

  if (!response.ok) {
    console.error("API error:", data);
    throw new Error(response.statusText);
  }
  console.log(data);
  return {
    data: data,
    newServerKnowledge: data.data.server_knowledge
  };
};

const createTransaction = async(budgetId, transactionData, exchangeAcct) => {
  // Check if the transaction is not approved; if so, do not create the transaction
  if (!transactionData.approved) {
    console.log('Transaction not created as it is not approved');
    return null;
  }

  // Define a list of restricted payee name prefixes
  const restrictedPayeePrefixes = [
    'Starting Balance',
    'Manual Balance Adjustment',
    'Reconciliation Balance Adjustment',
    'Transfer :'
  ];

  // Special handling for "Transfer :" transactions
  if (transactionData.payee_name.startsWith('Transfer :') && !transactionData.category_id) {
    // Modify the payee name and set the category ID if transaction is a "Transfer :" type without a category
    const newPayeeName = transactionData.payee_name.replace('Transfer :', '').trim();
    transactionData.payee_name = newPayeeName;
    transactionData.category_id = exchangeAcct;
    console.log(`exchange:`, exchangeAcct);
  } else {
    // Check for other restricted prefixes
    const restrictedPrefix = restrictedPayeePrefixes.find(prefix => transactionData.payee_name.startsWith(prefix));
    if (restrictedPrefix) {
      // For transactions with restricted prefixes, set payee to "Auto Created" and use exchangeAcct as the category
      console.log(`Transaction modified due to restricted prefix: ${restrictedPrefix}`);
      transactionData.payee_name = 'Auto Created';
      transactionData.category_id = exchangeAcct;
    }
  }

  const payload = { transactions: [transactionData] };
  console.log('budgetId in CreateTransaction', budgetId);
  console.log('Sending payload:', payload);

  try {
    const response = await fetch(`${ynabBaseUrl}/budgets/${budgetId}/transactions`, {
      headers,
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const responseBody = await response.json();
    if (!response.ok) {
      console.error("Detailed API error:", responseBody);
      throw new Error(response.statusText);
    }
    return responseBody;
  } catch (error) {
    console.error("Error creating the transaction:", error.message);
    throw error;
  }
};


const getExchangeRate = async(fromCurrency) => {
  let url;
  let toCurrency;

  if (fromCurrency === 'CAD') {
    url = 'https://open.er-api.com/v6/latest/CAD';
    toCurrency = 'USD'; // Convert USD to CAD
  } else if (fromCurrency === 'USD') {
    url = 'https://open.er-api.com/v6/latest/USD';
    toCurrency = 'CAD'; // Convert CAD to USD
  } else {
    throw new Error('Unsupported currency conversion');
  }

  const response = await fetch(url);
  const data = await response.json();
  return data.rates[toCurrency];
};


const getAllAccounts = async(budgetId) => {
  try {
    const url = `${ynabBaseUrl}/budgets/${budgetId}/accounts`;
    const response = await fetch(url, { headers, method: 'GET' });

    if (!response.ok) {
      const errorBody = await response.json();
      console.error("Error fetching accounts: ", errorBody);
      throw new Error(`API responded with status: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.accounts;
  } catch (error) {
    console.error("Error in getAllAccounts: ", error.message);
    throw error;
  }
};

const updateOriginalTransaction = async(budgetId, transactionId) => {
  try {
    const response = await fetch(`${ynabBaseUrl}/budgets/${budgetId}/transactions/${transactionId}`, {
      headers,
      method: 'PUT',
      body: JSON.stringify({ transaction: { flag_color: "green" } })
    });
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    return {
      data: data,
      newServerKnowledge: data.data.server_knowledge
    };
  } catch (error) {
    console.error("Error updating the transaction memo:", error.message);
    throw error;
  }
};

module.exports = { getExchangeRate, getTransactions, createTransaction, getAllAccounts, updateOriginalTransaction, searchTransactionsByMemo, deleteTransaction, updateServerKnowledge, getServerKnowledge };
