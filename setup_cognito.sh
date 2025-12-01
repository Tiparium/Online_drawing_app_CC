#!/bin/bash
# Cognito Setup Script
# Creates a new Cognito User Pool, App Client, and Hosted UI domain
# configured for self-signup with email + password (no admin-only restriction).

set -e

# --- EDIT THESE VALUES ---
REGION="us-east-1"
USER_POOL_NAME="whiteboard-app-users"
APP_CLIENT_NAME="whiteboard-app-web"
DOMAIN_PREFIX="online-drawing-app-auth-cs218-v2" # must be globally unique
FRONTEND_URL="https://d2s6tk6qg8cklz.cloudfront.net"
# --------------------------

echo "Creating Cognito User Pool (self-signup, email required)..."

POOL_ID=$(
  aws cognito-idp create-user-pool \
    --region "$REGION" \
    --pool-name "$USER_POOL_NAME" \
    --username-attributes "email" \
    --auto-verified-attributes "email" \
    --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":true}}' \
    --verification-message-template '{"DefaultEmailOption":"CONFIRM_WITH_CODE"}' \
    --admin-create-user-config '{"AllowAdminCreateUserOnly":false}' \
    --query 'UserPool.Id' \
    --output text
)

echo "User Pool ID: $POOL_ID"

echo "Creating User Pool App Client (public, code flow)..."

CLIENT_ID=$(
  aws cognito-idp create-user-pool-client \
    --region "$REGION" \
    --user-pool-id "$POOL_ID" \
    --client-name "$APP_CLIENT_NAME" \
    --no-generate-secret \
    --supported-identity-providers "COGNITO" \
    --allowed-o-auth-flows-user-pool-client \
    --allowed-o-auth-flows "code" \
    --allowed-o-auth-scopes "openid" "email" "profile" \
    --explicit-auth-flows "ALLOW_USER_SRP_AUTH" "ALLOW_REFRESH_TOKEN_AUTH" "ALLOW_USER_PASSWORD_AUTH" \
    --callback-urls "[\"$FRONTEND_URL\",\"$FRONTEND_URL/\"]" \
    --logout-urls "[\"$FRONTEND_URL\",\"$FRONTEND_URL/\"]" \
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
LOGIN_URL="${COG_DOMAIN}/login?client_id=${CLIENT_ID}&response_type=code&scope=openid+email+profile&redirect_uri=${FRONTEND_URL}"

echo ""
echo "===== COGNITO SETUP COMPLETE ====="
echo "Region:            $REGION"
echo "User Pool ID:      $POOL_ID"
echo "App Client ID:     $CLIENT_ID"
echo "Hosted UI Domain:  $COG_DOMAIN"
echo "Login URL:         $LOGIN_URL"
echo "Frontend URL:      $FRONTEND_URL"
echo ""
echo "NEXT:"
echo "  1) Update your frontend Auth config with the Pool ID, App Client ID, and Domain."
echo "  2) Optionally delete/leave the old pool; just ensure the frontend points here."
