const express = require('express');
const app = express();

const { getExchangeRate, getTransactions, createTransaction, getAllAccounts, updateOriginalTransaction, searchTransactionsByMemo, deleteTransaction, updateServerKnowledge, getServerKnowledge } = require('./helpers/api');
const calculateDifferenceTransaction = require('./helpers/transactions');

const processBudget = async(budgetId, flag, baseCurrency) => {
  let lastServerKnowledge = await getServerKnowledge(budgetId);
  const accounts = await getAllAccounts(budgetId);

  let latestServerKnowledge;

  const secondaryAccount = accounts.find(account => account.name.includes('💱'));
  if (!secondaryAccount) {
    console.error('Secondary account with symbol 💱 not found.');
    return;
  }
  const secondaryAccountId = secondaryAccount.id;
  console.log(`Secondary account ID for budget ${budgetId}: ${secondaryAccountId}`);

  const validAccounts = accounts.filter(account =>
    account.name.includes(flag) && !account.closed
  ).map(account => ({ ...account, currency: baseCurrency === 'CAD' ? 'USD' : 'CAD' }));

  for (const account of validAccounts) {
    const currencyRate = await getExchangeRate(account.currency);
    console.log(`Exchange rate for ${account.currency}: ${currencyRate}`);

    const { transactions, newServerKnowledge } = await getTransactions(budgetId, account.id, lastServerKnowledge);
    console.log(`Found ${transactions.length} transactions for account ${account.name} in budget ${budgetId}`);

    for (const transaction of transactions) {
      if (transaction.deleted) {
        // Deleting related transactions
        const relatedTransactions = await searchTransactionsByMemo(budgetId, secondaryAccountId, transaction.id);
        for (const relatedTransaction of relatedTransactions) {
          const deleteResponse = await deleteTransaction(budgetId, relatedTransaction.id);
          latestServerKnowledge = deleteResponse.newServerKnowledge;
          console.log(`Transaction was deleted, removing: ${relatedTransaction.id}`);
        }
      } else if (transaction.flag_color === 'green') {
        // Handling updated transactions
        const relatedTransactions = await searchTransactionsByMemo(budgetId, secondaryAccountId, transaction.id);
        for (const relatedTransaction of relatedTransactions) {
          await deleteTransaction(budgetId, relatedTransaction.id);
          console.log(`Transaction has been updated, removing old transaction: ${relatedTransaction.id}`);
    
          const newDifferenceTransaction = calculateDifferenceTransaction(transaction, currencyRate, account.name, secondaryAccountId);
          await createTransaction(budgetId, newDifferenceTransaction);
          console.log(`New difference transaction created for updated transaction ID: ${transaction.id}`);
        }
        const updateOriginalResponse = await updateOriginalTransaction(budgetId, transaction.id);
        latestServerKnowledge = updateOriginalResponse.newServerKnowledge;
        console.log('Original transaction updated successfully!');
      } else {
        const differenceTransaction = calculateDifferenceTransaction(transaction, currencyRate, account.name, secondaryAccountId);
        await createTransaction(budgetId, differenceTransaction);
        console.log(`New transaction created for ID: ${transaction.id} in budget ${budgetId}`);
        const updateOriginalResponse = await updateOriginalTransaction(budgetId, transaction.id);
        latestServerKnowledge = updateOriginalResponse.newServerKnowledge;
      }
    }
    await updateServerKnowledge(budgetId, latestServerKnowledge || newServerKnowledge);
  }
};

app.get('/run-task', async(req, res) => {
  try {
    await main();
    res.send('Budget processing completed.');
  } catch (error) {
    console.error(error);
    res.status(500).send('An error occurred while processing budgets.');
  }
});

const main = async() => {
  const budgets = [
    { id: 'ae7b9d9b-43e6-4ba6-ba40-cf938710fcc6', baseCurrency: 'CAD', flag: '🇺🇸'},
    { id: '9d532b9c-60d2-4d40-88ea-e72ddfd28fb0', baseCurrency: 'USD', flag: '🇨🇦'}
  ];

  for (const budget of budgets) {
    await processBudget(budget.id, budget.flag, budget.baseCurrency);
  }
};

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Export the Express app for testing purposes
module.exports = app;
