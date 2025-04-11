# Privy demo

1. Follow the doc [here](https://docs.privy.io/basics/get-started/dashboard/create-new-app) to obtain the Privy App ID and App Secret.
2. Add the following content to the `.env.local` file:
  ```
  NEXT_PUBLIC_PRIVY_APP_ID=your-app-id
  PRIVY_APP_SECRET=your-app-secret
  ```
3. Run `cd docker && docker compose up -d`
4. Run `npm install && npm run dev`