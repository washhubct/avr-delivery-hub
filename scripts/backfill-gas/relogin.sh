#!/usr/bin/env bash
# Rilogin ADC con scope Drive+Sheets per amministrazione@avrlogisticarl.com
set -e

SCOPES="openid,https://www.googleapis.com/auth/userinfo.email"
SCOPES+=",https://www.googleapis.com/auth/drive.readonly"
SCOPES+=",https://www.googleapis.com/auth/spreadsheets.readonly"
SCOPES+=",https://www.googleapis.com/auth/cloud-platform"

echo "🔑 Apro browser per riautenticare amministrazione@avrlogisticarl.com..."
gcloud auth application-default login \
    --account="amministrazione@avrlogisticarl.com" \
    --scopes="$SCOPES"

echo "✅ Fatto. Rilancia find-folder.js."
