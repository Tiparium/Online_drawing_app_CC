#!/bin/bash
# Cognito Setup Script by James
# Creates a Cognito User Pool, App Client, and Hosted UI domain for the drawing app

set -e

REGION="us-east-1"
USER_POOL_NAME="drawing-app-users"
APP_CLIENT_NAME="drawing-app-web"
DOMAIN_PREFIX="online-drawing-app-auth-cs218" # must be globally unique
FRONTEND_URL="https://d2s6tk6qg8cklz.cloudfront.net"

echo "Creating Cognito User Pool (admin-create only)..."

POOL_ID=$(
  aws cognito-idp create-user-pool \
    --region "$REGION" \
    --pool-name "$USER_POOL_NAME" \
    --admin-create-user-config '{"AllowAdminCreateUserOnly":true}' \
    --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":true}}' \
    --auto-verified-attributes "email" \
    --query 'UserPool.Id' \
    --output text
)

echo "User Pool ID: $POOL_ID"

echo "Creating User Pool App Client (no secret, for browser app)..."

CLIENT_ID=$(
  aws cognito-idp create-user-pool-client \
    --region "$REGION" \
    --user-pool-id "$POOL_ID" \
    --client-name "$APP_CLIENT_NAME" \
    --no-generate-secret \
    --explicit-auth-flows "ALLOW_USER_PASSWORD_AUTH" "ALLOW_REFRESH_TOKEN_AUTH" \
    --supported-identity-providers "COGNITO" \
    --callback-urls "[\"$FRONTEND_URL\"]" \
    --logout-urls "[\"$FRONTEND_URL\"]" \
    --allowed-o-auth-flows "code" \
    --allowed-o-auth-scopes "openid" "email" "profile" \
    --allowed-o-auth-flows-user-pool-client \
    --query 'UserPoolClient.ClientId' \
    --output text
)

echo "App Client ID: $CLIENT_ID"

echo "Creating Cognito Hosted UI domain..."

aws cognito-idp create-user-pool-domain \
  --region "$REGION" \
  --domain "$DOMAIN_PREFIX" \
  --user-pool-id "$POOL_ID" >/dev/null

COG_DOMAIN="https://${DOMAIN_PREFIX}.auth.${REGION}.amazoncognito.com"

echo ""
echo "===== COGNITO SETUP COMPLETE ====="
echo "Region:          $REGION"
echo "User Pool ID:    $POOL_ID"
echo "App Client ID:   $CLIENT_ID"
echo "Hosted UI URL:   $COG_DOMAIN"
echo "Frontend URL:    $FRONTEND_URL"
echo ""
echo "Save these values; you’ll plug them into your frontend (Amplify/Auth config)."
