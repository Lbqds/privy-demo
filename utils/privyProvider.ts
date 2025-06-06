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
  TOTAL_NUMBER_OF_GROUPS,
  binToHex,
  hexToBinUnsafe,
  toApiTokens,
  contractIdFromAddress,
  TransactionBuilder,
  addressFromPublicKey,
  groupOfAddress
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
    readonly explorerProvider: ExplorerProvider | undefined,
    readonly txBuilder: TransactionBuilder = TransactionBuilder.from(nodeProvider)
  ) {
    super();
    this.accounts = connectedWallets.map((wallet) => {
      const publicKey = bs58.decode(wallet.address)
      return {
        ...wallet,
        address: getAlphAddress(publicKey),
        keyType: 'gl-ed25519',
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

  private async _signAndSubmitTransferTx(account: Account & PrivySolanaWallet, buildResult: Omit<SignTransferTxResult, 'signature'>) {
    const signature = await account.signMessage(hexToBinUnsafe(buildResult.txId))
    const signedTx = { ...buildResult, signature: binToHex(signature) }
    await this.nodeProvider.transactions.postTransactionsSubmit(signedTx)
    return signedTx
  }

  private async signAndSubmitTransferTxs(account: Account & PrivySolanaWallet, buildResults: Omit<SignTransferTxResult, 'signature'>[]) {
    const results: SignTransferTxResult[] = []
    for (const buildResult of buildResults) {
      const result = await this._signAndSubmitTransferTx(account, buildResult)
      results.push(result)
    }
    return results
  }

  async signAndSubmitTransferTx(params: SignTransferTxParams): Promise<SignTransferTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResult = await this.txBuilder.buildTransferTx({
      signerAddress: account.address,
      signerKeyType: 'gl-ed25519',
      destinations: params.destinations.map((d) => ({
        address: d.address,
        attoAlphAmount: d.attoAlphAmount.toString()
      }))
    }, account.publicKey)
    if ('fundingTxs' in buildResult && buildResult.fundingTxs !== undefined) {
      await this.signAndSubmitTransferTxs(account, buildResult.fundingTxs)
    }
    return this._signAndSubmitTransferTx(account, buildResult)
  }

  async signAndSubmitDeployContractTx(params: SignDeployContractTxParams): Promise<SignDeployContractTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResult = await this.txBuilder.buildDeployContractTx({
      signerAddress: account.address,
      signerKeyType: 'gl-ed25519',
      bytecode: params.bytecode,
      initialAttoAlphAmount: params.initialAttoAlphAmount?.toString(),
      initialTokenAmounts: toApiTokens(params.initialTokenAmounts),
      issueTokenAmount: params.issueTokenAmount?.toString(),
      issueTokenTo: params.issueTokenTo,
      gasPrice: params.gasPrice?.toString(),
      group: params.group ?? groupOfAddress(account.address)
    }, account.publicKey)
    if ('fundingTxs' in buildResult && buildResult.fundingTxs !== undefined) {
      await this.signAndSubmitTransferTxs(account, buildResult.fundingTxs)
    }
    const signature = await account.signMessage(hexToBinUnsafe(buildResult.txId))
    const result = { ...buildResult, signature: binToHex(signature) }
    await this.nodeProvider.transactions.postTransactionsSubmit(result)
    return { ...result, contractId: binToHex(contractIdFromAddress(result.contractAddress)) }
  }

  async signAndSubmitExecuteScriptTx(params: SignExecuteScriptTxParams): Promise<SignExecuteScriptTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResult = await this.txBuilder.buildExecuteScriptTx({
      signerAddress: account.address,
      signerKeyType: 'gl-ed25519',
      bytecode: params.bytecode,
      attoAlphAmount: params.attoAlphAmount?.toString(),
      tokens: toApiTokens(params.tokens),
      gasPrice: params.gasPrice?.toString(),
      group: params.group ?? groupOfAddress(account.address),
      gasEstimationMultiplier: params.gasEstimationMultiplier
    }, account.publicKey)
    if ('fundingTxs' in buildResult && buildResult.fundingTxs !== undefined) {
      await this.signAndSubmitTransferTxs(account, buildResult.fundingTxs)
    }
    const signature = await account.signMessage(hexToBinUnsafe(buildResult.txId))
    const result = { ...buildResult, signature: binToHex(signature) }
    await this.nodeProvider.transactions.postTransactionsSubmit(result)
    return result
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

export function getAlphAddressFromSolAddress(solAddress: string): string {
  return getAlphAddress(bs58.decode(solAddress))
}

function getAlphAddress(publicKey: Uint8Array): string {
  const publicKeyHex = binToHex(publicKey)
  return addressFromPublicKey(publicKeyHex, 'gl-ed25519')
}

function getGroup(publicKey: Uint8Array): number {
  const lastByte = publicKey[publicKey.length - 1] as number
  return lastByte % TOTAL_NUMBER_OF_GROUPS;
}
