/* eslint-disable camelcase */
const calculateDifferenceTransaction = (transaction, currencyRate, originalAccountName, accountId) => {
  console.log("Transaction:", transaction);
  console.log("Currency Rate:", currencyRate);

  const transactionAmountInUnits = transaction.amount / 1000;
  const convertedAmountInUnits = transactionAmountInUnits * currencyRate;
  const differenceInUnits = convertedAmountInUnits - transactionAmountInUnits;
  const differenceInMilliunits = Math.round(differenceInUnits * 1000);

  const differenceTransaction = {
    account_id: accountId,
    date: transaction.date,
    amount: differenceInMilliunits,
    payee_name: transaction.payee_name,
    category_id: transaction.category_id,
    memo: `${originalAccountName.replace('🇺🇸', '').trim()}: ${transaction.memo ? transaction.memo + ' - ' : ''}${transaction.id}`,
    approved: true,
    cleared: transaction.cleared,
    subtransactions: []
  };

  if (transaction.subtransactions && transaction.subtransactions.length > 0) {
    let distributedDifference = 0;

    for (let i = 0; i < transaction.subtransactions.length; i++) {
      const sub = transaction.subtransactions[i];
      const subAmountInUnits = sub.amount / 1000;
      const subConvertedAmountInUnits = subAmountInUnits * currencyRate;
      let subDifferenceInUnits = subConvertedAmountInUnits - subAmountInUnits;
      let subDifferenceInMilliunits;

      if (i === transaction.subtransactions.length - 1) {
        // For the last subtransaction, adjust to match the total difference
        subDifferenceInMilliunits = differenceInMilliunits - distributedDifference;
      } else {
        subDifferenceInMilliunits = Math.round(subDifferenceInUnits * 1000);
        distributedDifference += subDifferenceInMilliunits;
      }

      differenceTransaction.subtransactions.push({
        amount: subDifferenceInMilliunits,
        payee_id: sub.payee_id,
        category_id: sub.category_id,
        memo: sub.memo || null
      });
    }
  }

  return differenceTransaction;
};

module.exports = calculateDifferenceTransaction;