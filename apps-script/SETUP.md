# Coupledger on Google Sheets: setup (about 10 minutes)

Coupledger keeps all its data in one Google Sheet. A small Google Apps Script (`Code.gs`) sits in front of the sheet and handles sign-up, sign-in, households and entries. The app talks to that script.

## 1. Create the sheet and paste the script
1. Go to sheets.google.com and create a new, **empty, private** spreadsheet. Name it `Coupledger Data`.
2. Open **Extensions > Apps Script**.
3. Delete the sample code, then paste the whole of `apps-script/Code.gs`.
4. Near the top, set `APP_URL` to the address where your web app lives (for example `https://demo.amortree.com/Coupledger/`). Password-reset emails link there.
5. Click **Save**.

## 2. Authorize it once
1. In the function menu choose **setup**, then click **Run**.
2. Google asks for permission (Sheets and sending email). Choose your account, then **Advanced > Go to project (unsafe)** and **Allow**. This warning appears for every personal script you write yourself.
3. The sheet now has its tabs: Users, Sessions, Households, Members, Invites, Accounts, Categories, Entries, Settings.

## 3. Publish it as a web app
1. Click **Deploy > New deployment**, choose the gear icon and **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.
3. Click **Deploy** and copy the **Web app URL** (it ends with `/exec`).

"Anyone" only means the address can be reached. Nobody can read or change data without signing in.

## 4. Point the app at it
1. Open `app/index.html` and find `const SHEETS_API_URL = '...'` near the start of the main script.
2. Paste your web app URL between the quotes.
3. Upload the `app` folder to your site.

## 5. Try it
Open the app, choose **Create account**, start a household, add an expense and check that a row appears in the **Entries** tab. Invite your partner with the code or link from Home.

## Updating the script later
Paste the new code, then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**. The URL stays the same.

## Keep in mind
- **Keep the sheet private.** Anyone who can open it can read all the data, including password hashes. Do not share it, and do not edit its tabs by hand while people use the app.
- **Passwords** are stored as salted, iterated hashes, never as plain text. A secret key kept in the script's properties is mixed in. Choose long passwords.
- **Speed.** Each action takes roughly 1 to 2 seconds. Partners see each other's changes within about 8 seconds, because the app checks for changes instead of receiving live pushes.
- **Limits.** Google caps how long a free account's scripts can run each day (around 90 minutes) and how many emails they can send (about 100 a day on a free Gmail account). That is plenty for a few dozen households, not for a large public service. If Coupledger grows, move to a real database.
- **Backups.** Use **File > Make a copy** now and then, or add a weekly time-driven trigger that copies the sheet.
- **Old data.** Anything stored in Supabase is not moved automatically. Ask for a one-time import if you need it.

## Tests
`apps-script/tests/` holds an automated test that runs the real `Code.gs` and the real app client against a stand-in for Google's services (57 checks: sign-up, households, invites, privacy between households, balances, edits, password reset and more). Run it with `node apps-script/tests/test.js`.
