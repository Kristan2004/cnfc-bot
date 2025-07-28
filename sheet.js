const { GoogleSpreadsheet } = require('google-spreadsheet');
const creds = require('./creds.json');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

async function accessSheet() {
  const doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  return doc.sheetsByTitle['ChainFabric Bot Users']; // must match the sheet name exactly
}

module.exports = accessSheet;
