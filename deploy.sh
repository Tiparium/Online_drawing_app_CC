#!/bin/bash
# S3 Deployment Script by Sathya
# Deploys drawing app frontend to AWS S3

set -e

BUCKET_NAME="drawing-app-frontend"
REGION="us-east-1"

echo "Deploying to S3..."
echo "Bucket: $BUCKET_NAME"
echo "Region: $REGION"
echo ""

# Create bucket if doesn't exist
if aws s3 ls "s3://$BUCKET_NAME" 2>&1 | grep -q 'NoSuchBucket'; then
    aws s3 mb "s3://$BUCKET_NAME" --region "$REGION"
fi

# Enable website hosting
aws s3 website "s3://$BUCKET_NAME" --index-document index.html

# Disable block public access
aws s3api put-public-access-block \
    --bucket "$BUCKET_NAME" \
    --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Set public read policy
cat > /tmp/policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
  }]
}
EOF

aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy file:///tmp/policy.json
rm /tmp/policy.json

# Upload files
aws s3 sync public/ "s3://$BUCKET_NAME/" --delete

echo ""
echo "✓ Deployed successfully!"
echo "URL: http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com"
