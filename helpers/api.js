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

    if (error) throw error;

    return data ? data.server_knowledge : 0;
  } catch (error) {
    console.error('Error retrieving server knowledge:', error.message);
    return 0;
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

const createTransaction = async(budgetId, transactionData) => {
  // Define a list of restricted payee name prefixes
  const restrictedPayeePrefixes = [
    'Starting Balance',
    'Manual Balance Adjustment',
    'Reconciliation Balance Adjustment',
    'Transfer :'
  ];

  // Check if the transaction's payee name starts with "Transfer :" and return early if true
  if (transactionData.payee_name.startsWith('Transfer :') && !transactionData.category_id) {
    console.log('Transaction skipped due to "Transfer :" prefix and no category');
    return null; // Exit the function, indicating no transaction is created
  }

  const restrictedPrefix = restrictedPayeePrefixes.find(prefix => transactionData.payee_name.startsWith(prefix));

  if (restrictedPrefix) {
    // Remove the restricted prefix and trim any leading/trailing spaces
    const newPayeeName = transactionData.payee_name.replace(restrictedPrefix, '').trim();
    transactionData.payee_name = `Exchange: ${newPayeeName}`;
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
