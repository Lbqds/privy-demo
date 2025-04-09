import {
  Account,
  ExplorerProvider,
  NodeProvider,
  SignTransferTxResult,
  SignDeployContractTxParams,
  SignDeployContractTxResult,
  SignerProvider,
  SignTransferTxParams,
  SignExecuteScriptTxParams,
  SignExecuteScriptTxResult,
  SignUnsignedTxParams,
  SignUnsignedTxResult,
  SignChainedTxParams,
  SignChainedTxResult,
  SignMessageParams,
  SignMessageResult,
  bs58,
  concatBytes,
  codec,
  TOTAL_NUMBER_OF_GROUPS,
  binToHex,
  hexToBinUnsafe,
  toApiTokens,
  contractIdFromAddress,
  TransactionBuilder
} from "@alephium/web3";

interface PrivySolanaWallet {
  type: 'solana'
  address: string
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

export class PrivyAlephiumProvider extends SignerProvider {
  private readonly accounts: (Account & PrivySolanaWallet)[]

  constructor(
    connectedWallets: PrivySolanaWallet[],
    readonly nodeProvider: NodeProvider,
    readonly explorerProvider: ExplorerProvider | undefined
  ) {
    super();
    this.accounts = connectedWallets.map((wallet) => {
      const publicKey = bs58.decode(wallet.address)
      return {
        ...wallet,
        address: getAlphAddress(publicKey),
        keyType: 'default', // FIXME: ed25519
        group: getGroup(publicKey),
        publicKey: binToHex(publicKey)
      }
    })
  }

  async unsafeGetSelectedAccount(): Promise<Account & PrivySolanaWallet> {
    const account = this.accounts[0]
    if (account === undefined) {
      throw new Error('No connected wallets')
    }
    return account
  }

  override getSelectedAccount(): Promise<Account> {
    return this.unsafeGetSelectedAccount()
  }

  private async getAccountByAddress(address: string): Promise<Account & PrivySolanaWallet> {
    const account = await this.unsafeGetSelectedAccount()
    if (account.address !== address) {
      throw new Error(`Invalid selected address ${address}`)
    }
    return account
  }

  async signAndSubmitTransferTx(params: SignTransferTxParams): Promise<SignTransferTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResults = await this.nodeProvider.groupless.postGrouplessTransfer({
      fromAddress: account.address,
      destinations: params.destinations.map((d) => ({
        address: d.address,
        attoAlphAmount: d.attoAlphAmount.toString()
      }))
    })
    if (buildResults.length === 0) throw new Error('Not enough balance')
    if (buildResults.length > 1) throw new Error('Not supported')
    const buildResult = buildResults[0]!
    const signature = await account.signMessage(hexToBinUnsafe(buildResult.txId))
    const result = { ...buildResult, signature: binToHex(signature) }
    await this.nodeProvider.transactions.postTransactionsSubmit(result)
    return result
  }

  async signAndSubmitDeployContractTx(params: SignDeployContractTxParams): Promise<SignDeployContractTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResult = await this.nodeProvider.groupless.postGrouplessDeployContract({
      fromAddress: account.address,
      bytecode: params.bytecode,
      initialAttoAlphAmount: params.initialAttoAlphAmount?.toString(),
      initialTokenAmounts: toApiTokens(params.initialTokenAmounts),
      issueTokenAmount: params.issueTokenAmount?.toString(),
      issueTokenTo: params.issueTokenTo,
      gasPrice: params.gasPrice?.toString(),
    })
    if (buildResult.transferTxs.length !== 0) throw new Error('Not supported')
    const signature = await account.signMessage(hexToBinUnsafe(buildResult.deployContractTx.txId))
    const result = { ...buildResult.deployContractTx, signature: binToHex(signature) }
    await this.nodeProvider.transactions.postTransactionsSubmit(result)
    return { ...result, groupIndex: account.group, contractId: binToHex(contractIdFromAddress(result.contractAddress)) }
  }

  async signAndSubmitExecuteScriptTx(params: SignExecuteScriptTxParams): Promise<SignExecuteScriptTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResult = await this.nodeProvider.groupless.postGrouplessExecuteScript({
      fromAddress: account.address,
      bytecode: params.bytecode,
      attoAlphAmount: params.attoAlphAmount?.toString(),
      tokens: toApiTokens(params.tokens),
      gasPrice: params.gasPrice?.toString(),
      gasEstimationMultiplier: params.gasEstimationMultiplier
    })
    if (buildResult.transferTxs.length !== 0) throw new Error('Not supported')
    const signature = await account.signMessage(hexToBinUnsafe(buildResult.executeScriptTx.txId))
    const result = { ...buildResult.executeScriptTx, signature: binToHex(signature) }
    await this.nodeProvider.transactions.postTransactionsSubmit(result)
    return { ...result, groupIndex: account.group }
  }

  async signAndSubmitUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const unsignedTx = TransactionBuilder.buildUnsignedTx(params)
    const signature = await account.signMessage(hexToBinUnsafe(unsignedTx.txId))
    const result = { ...unsignedTx, signature: binToHex(signature) }
    await this.nodeProvider.transactions.postTransactionsSubmit(result)
    return result
  }

  async signUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const unsignedTx = TransactionBuilder.buildUnsignedTx(params)
    const signature = await account.signMessage(hexToBinUnsafe(unsignedTx.txId))
    return { ...unsignedTx, signature: binToHex(signature) }
  }

  async signAndSubmitChainedTx(_: SignChainedTxParams[]): Promise<SignChainedTxResult[]> {
    throw new Error("Not implemented")
  }

  async signMessage(_: SignMessageParams): Promise<SignMessageResult> {
    throw new Error("Not implemented")
  }
}

function djb2(bytes: Uint8Array): number {
  let hash = 5381
  for (let i = 0; i < bytes.length; i++) {
    hash = (hash << 5) + hash + (bytes[`${i}`]! & 0xff)
  }
  return hash
}

export function getAlphAddressFromSolAddress(solAddress: string): string {
  return getAlphAddress(bs58.decode(solAddress))
}

function getAlphAddress(publicKey: Uint8Array): string {
  const encodedPublicKey = concatBytes([new Uint8Array([2]), publicKey])
  const checksum = djb2(encodedPublicKey)
  const bytes = concatBytes([
    new Uint8Array([4]),
    encodedPublicKey,
    codec.intAs4BytesCodec.encode(checksum),
  ])
  const group = getGroup(publicKey)
  return `${bs58.encode(bytes)}:${group}`
}

function getGroup(publicKey: Uint8Array): number {
  const lastByte = publicKey[publicKey.length - 1] as number
  return lastByte % TOTAL_NUMBER_OF_GROUPS;
}
