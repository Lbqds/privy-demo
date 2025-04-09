import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { usePrivy, User } from "@privy-io/react-auth";
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import Head from "next/head";
import { getAlphAddressFromSolAddress, PrivyAlephiumProvider } from "./provider";
import { convertAlphAmountWithDecimals, DUST_AMOUNT, NodeProvider, ONE_ALPH, publicKeyFromPrivateKey, sign as signRaw, stringToHex } from "@alephium/web3";
import { TokenFaucet, Withdraw } from "../artifacts/ts";

const nodeProvider = new NodeProvider('http://127.0.0.1:22973')

export default function DashboardPage() {
  const router = useRouter();
  const { ready, authenticated, user, logout } = usePrivy();
  const [isUserObjectExpanded, setIsUserObjectExpanded] = useState(false);
  const solanaWallets = useSolanaWallets();
  const provider = new PrivyAlephiumProvider(solanaWallets.wallets, nodeProvider, undefined)

  const [transferTo, setTransferTo] = useState<string>('')
  const [transferAmount, setTransferAmount] = useState<string>('')

  const [tokenId, setTokenId] = useState<string>('')
  const [txId, setTxId] = useState<string>('')

  useEffect(() => {
    if (ready && !authenticated) {
      router.push("/");
    }
  }, [ready, authenticated, router]);

  return (
    <>
      <Head>
        <title>Privy Auth Demo</title>
      </Head>

      <main className="flex flex-col min-h-screen px-4 sm:px-20 py-6 sm:py-10 bg-privy-light-blue">
        {ready && authenticated ? (
          <>
            <div className="flex flex-row justify-between">
              <h1 className="text-2xl font-semibold">Privy Auth Demo</h1>
              <button
                onClick={logout}
                className="text-sm bg-violet-200 hover:text-violet-900 py-2 px-4 rounded-md text-violet-700"
              >
                Logout
              </button>
            </div>

            <div className="mt-6">
              <button
                onClick={() => setIsUserObjectExpanded(!isUserObjectExpanded)}
                className="flex items-center gap-2 font-bold uppercase text-sm text-gray-600 hover:text-gray-800"
              >
                <span>User object</span>
                <span className="text-lg">{isUserObjectExpanded ? '▼' : '▶'}</span>
              </button>
              {isUserObjectExpanded && (
                <pre className="max-w-4xl bg-slate-700 text-slate-50 font-mono p-4 text-xs sm:text-sm rounded-md mt-2">
                  {JSON.stringify(addAlphAccounts(user), null, 2)}
                </pre>
              )}
            </div>

            <div className="mt-6 space-y-4">
              <div className="max-w-md">
                <label htmlFor="transferTo" className="block text-sm font-medium text-gray-700 mb-1">
                  Transfer To
                </label>
                <input
                  type="text"
                  id="transferTo"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm"
                  placeholder="Enter address"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                />
              </div>
              <div className="max-w-md">
                <label htmlFor="transferAmount" className="block text-sm font-medium text-gray-700 mb-1">
                  Transfer Amount
                </label>
                <input
                  type="number"
                  id="transferAmount"
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-violet-500 focus:ring-violet-500 sm:text-sm"
                  placeholder="Enter amount"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                />
              </div>
              <div className="max-w-md">
                <button
                  onClick={async () => {
                    if (transferTo && transferAmount) {
                      const account = await provider.unsafeGetSelectedAccount();
                      await transferFromDevGenesis(account.address);
                      const result = await provider.signAndSubmitTransferTx({
                        signerAddress: account.address,
                        destinations: [{ address: transferTo, attoAlphAmount: convertAlphAmountWithDecimals(transferAmount)! }]
                      })
                      setTxId(result.txId)
                      console.log(`from address: ${account.address}, ${account.group}, ${account.publicKey}`)
                      console.log(`tx id: ${result.txId}`)
                    }
                  }}
                  className="w-full bg-violet-500 hover:bg-violet-800 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
                >
                  Transfer
                </button>

                <button
                  onClick={async () => {
                    const account = await provider.unsafeGetSelectedAccount()
                    await transferFromDevGenesis(account.address)
                    const issueTokenAmount = 100n
                    const result = await TokenFaucet.deploy(provider, {
                      initialFields: {
                        symbol: stringToHex('TF'),
                        name: stringToHex('TokenFaucet'),
                        decimals: 18n,
                        supply: issueTokenAmount,
                        balance: issueTokenAmount
                      },
                      issueTokenAmount
                    })
                    setTokenId(result.contractInstance.contractId)
                    setTxId(result.txId)
                    console.log(`contract address: ${result.contractInstance.address}`)
                    console.log(`token id: ${result.contractInstance.contractId}`)
                  }}
                  className="mt-10 w-full bg-violet-500 hover:bg-violet-800 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors"
                >
                  Create Token
                </button>

                <button
                  onClick={async () => {
                    const result = await Withdraw.execute(provider, {
                      initialFields: {
                        token: tokenId,
                        amount: 1n
                      },
                      attoAlphAmount: DUST_AMOUNT,
                    })
                    setTxId(result.txId)
                    console.log(`tx id: ${result.txId}`)
                  }}
                  disabled={tokenId === ''}
                  className="mt-10 w-full bg-violet-500 hover:bg-violet-800 text-white py-2 px-4 rounded-md text-sm font-medium transition-colors disabled:hover:bg-violet-500 disabled:cursor-not-allowed"
                >
                  Mint Token
                </button>

                <div className="inline-flex items-center mt-8">
                  {txId !== '' ? (<span>{txId}</span>) : (<></>)}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </main>
    </>
  );
}

async function transferFromDevGenesis(toAddress: string) {
  const balance = await nodeProvider.addresses.getAddressesAddressBalance(toAddress)
  if (BigInt(balance.balance) > 0n) {
    return
  }

  const privateKey = 'a642942e67258589cd2b1822c631506632db5a12aabcf413604e785300d762a5'
  const publicKey  = publicKeyFromPrivateKey(privateKey)
  const amount = 100n * ONE_ALPH
  const buildResult = await nodeProvider.transactions.postTransactionsBuild({
    fromPublicKey: publicKey,
    destinations: [{ address: toAddress, attoAlphAmount: amount.toString() }]
  })
  const signature = signRaw(buildResult.txId, privateKey)
  await nodeProvider.transactions.postTransactionsSubmit({
    unsignedTx: buildResult.unsignedTx,
    signature
  })
}

function addAlphAccounts(user: User | null) {
  if (user === null) return null
  const alephiumAccounts: any[] = []
  user.linkedAccounts.forEach((a) => {
    if (a.type === 'wallet' && a.chainType === 'solana') {
      alephiumAccounts.push({ ...a, address: getAlphAddressFromSolAddress(a.address), chainType: 'alephium' })
    }
  })
  const newLinkedAccounts = alephiumAccounts.concat(user.linkedAccounts)
  return { ...user, linkedAccounts: newLinkedAccounts }
}
