const { getExchangeRate, getTransactions, createTransaction, getAllAccounts, updateOriginalTransaction, searchTransactionsByMemo, deleteTransaction, updateServerKnowledge, getServerKnowledge } = require('./helpers/api');
const calculateDifferenceTransaction = require('./helpers/transactions');
require('dotenv').config();

// eslint-disable-next-line no-unused-vars
exports.handler = async(event, context) => {
  try {
    console.log('Starting YNAB currency conversion...');
    await main();
    console.log('✨ Processing completed successfully');
    return { statusCode: 200, body: JSON.stringify('Budget processing completed.') };
  } catch (error) {
    console.error('❌ Processing failed:', error);
    return { statusCode: 500, body: JSON.stringify('An error occurred while processing budgets.') };
  }
};

const processBudget = async(budgetId, flag, baseCurrency, exchangeAcct) => {
  console.log('Processing budget:', { budgetId, flag, baseCurrency });
  
  try {
    let lastServerKnowledge = await getServerKnowledge(budgetId);
    console.log('Retrieved server knowledge:', lastServerKnowledge);
    
    const accounts = await getAllAccounts(budgetId);
    console.log('Retrieved accounts:', accounts.length);

    let latestServerKnowledge;

    const secondaryAccount = accounts.find(account => account.name.includes('💱'));
    if (!secondaryAccount) {
      throw new Error('Secondary account with symbol 💱 not found');
    }
    const secondaryAccountId = secondaryAccount.id;
    console.log('Found secondary account:', secondaryAccountId);

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
            await createTransaction(budgetId, newDifferenceTransaction, exchangeAcct);
            console.log(`New difference transaction created for updated transaction ID: ${transaction.id}`);
          }
          const updateOriginalResponse = await updateOriginalTransaction(budgetId, transaction.id);
          latestServerKnowledge = updateOriginalResponse.newServerKnowledge;
          console.log('Original transaction updated successfully!');
        } else {
          const differenceTransaction = calculateDifferenceTransaction(transaction, currencyRate, account.name, secondaryAccountId);
          await createTransaction(budgetId, differenceTransaction, exchangeAcct);
          console.log(`New transaction created for ID: ${transaction.id} in budget ${budgetId}`);
          const updateOriginalResponse = await updateOriginalTransaction(budgetId, transaction.id);
          latestServerKnowledge = updateOriginalResponse.newServerKnowledge;
        }
        await updateServerKnowledge(budgetId, latestServerKnowledge || newServerKnowledge);
      }
    }
  } catch (error) {
    console.error('❌ ERROR:', { message: 'Error processing budget', error });
  }
};

const main = async() => {
  const budgets = [
    {
      id: process.env.BUDGET_ID,
      baseCurrency: 'USD',
      flag: '🇨🇦',
      exchangeAcct: process.env.EXCHANGE_ACCOUNT_ID
    }
  ];

  for (const budget of budgets) {
    await processBudget(budget.id, budget.flag, budget.baseCurrency, budget.exchangeAcct);
  }
};

// If running directly (not as Lambda)
if (require.main === module) {
  main()
    .then(() => console.log('✨ Completed'))
    .catch(error => {
      console.error('❌ Failed:', error);
      process.exit(1);
    });
}