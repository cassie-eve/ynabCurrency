/* eslint-disable camelcase */
/* eslint-disable func-style */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const ynabClientId = process.env.YNAB_CLIENT_ID;
const ynabClientSecret = process.env.YNAB_CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;

function getQueryParam(name) {
  const queryParams = new URLSearchParams(window.location.search);
  return queryParams.get(name);
}

async function handleCallback() {
  const code = getQueryParam('code');
  if (!code) {
    console.error('Authorization code not found in URL');
    return;
  }

  // Exchange the authorization code for an access token
  const tokenResponse = await fetch('https://app.ynab.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: `client_id=${ynabClientId}&client_secret=${ynabClientSecret}&redirect_uri=${redirectUri}&grant_type=authorization_code&code=${code}`
  });

  const tokenData = await tokenResponse.json();
  const { access_token, refresh_token } = tokenData;

  // Get user's YNAB information
  const userResponse = await fetch('https://api.youneedabudget.com/v1/user', {
    headers: { 'Authorization': `Bearer ${access_token}` }
  });
  const userData = await userResponse.json();
  const ynabUserId = userData.data.user.id;

  // Get user's default budget
  const budgetResponse = await fetch('https://api.youneedabudget.com/v1/budgets/default', {
    headers: { 'Authorization': `Bearer ${access_token}` }
  });
  const budgetData = await budgetResponse.json();
  const defaultBudgetId = budgetData.data.budget.id;

  // Store token, user, and budget details in the database
  const result = await supabase
    .from('users')
    .insert([
      {
        id: ynabUserId,
        access_token: access_token,
        refresh_token: refresh_token,
        budget_id: defaultBudgetId,
        last_updated: new Date().toISOString()
      }
    ]);

  if (result.error) {
    console.error('Error saving token data:', result.error);
  } else {
    console.log('Token data saved successfully');
  }
}

handleCallback();
