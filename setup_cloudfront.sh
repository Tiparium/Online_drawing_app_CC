#!/bin/bash
set -e


REGION="us-east-1"
BUCKET_NAME="drawing-app-frontend"   
PRICE_CLASS="PriceClass_100"         


ORIGIN_DOMAIN="${BUCKET_NAME}.s3-website-${REGION}.amazonaws.com"
CALLER_REF="drawing-app-$(date +%s)"

echo "Creating CloudFront distribution for origin: $ORIGIN_DOMAIN"
echo ""

# Build a minimal-but-good distribution config JSON
TMP_CONFIG=/tmp/cloudfront-config.json

cat > "$TMP_CONFIG" <<EOF
{
  "CallerReference": "${CALLER_REF}",
  "Comment": "Drawing app frontend via CloudFront",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "s3-website-${BUCKET_NAME}",
        "DomainName": "${ORIGIN_DOMAIN}",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only",
          "OriginSslProtocols": {
            "Quantity": 3,
            "Items": ["TLSv1", "TLSv1.1", "TLSv1.2"]
          }
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-website-${BUCKET_NAME}",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      }
    },
    "Compress": true,
    "ForwardedValues": {
      "QueryString": true,
      "Cookies": {
        "Forward": "all"
      },
      "Headers": {
        "Quantity": 0
      },
      "QueryStringCacheKeys": {
        "Quantity": 0
      }
    },
    "TrustedSigners": {
      "Enabled": false,
      "Quantity": 0
    },
    "TrustedKeyGroups": {
      "Enabled": false,
      "Quantity": 0
    },
    "MinTTL": 0,
    "DefaultTTL": 0,
    "MaxTTL": 31536000
  },
  "DefaultRootObject": "index.html",
  "Aliases": {
    "Quantity": 0
  },
  "PriceClass": "${PRICE_CLASS}",
  "ViewerCertificate": {
    "CloudFrontDefaultCertificate": true
  },
  "Restrictions": {
    "GeoRestriction": {
      "RestrictionType": "none",
      "Quantity": 0
    }
  }
}
EOF

# Create the distribution
DIST_DOMAIN=$(
  aws cloudfront create-distribution \
    --distribution-config file://"$TMP_CONFIG" \
    --query 'Distribution.DomainName' \
    --output text
)

echo ""
echo "CloudFront distribution created."
echo "CloudFront Domain: https://${DIST_DOMAIN}"
echo ""
echo "Use this HTTPS URL as your FRONTEND_URL / callback URL in Cognito:"
echo "  https://${DIST_DOMAIN}"
