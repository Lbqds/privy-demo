import {
  binToHex,
  concatBytes,
  codec,
  HexString,
  hexToBinUnsafe,
  SignerProvider,
  Account,
  NodeProvider,
  ExplorerProvider,
  SignTransferTxParams,
  SignTransferTxResult,
  SignDeployContractTxParams,
  SignDeployContractTxResult,
  toApiTokens,
  contractIdFromAddress,
  SignExecuteScriptTxParams,
  SignExecuteScriptTxResult,
  SignUnsignedTxParams,
  SignUnsignedTxResult,
  SignChainedTxParams,
  SignChainedTxResult,
  SignMessageParams,
  SignMessageResult,
  TransactionBuilder,
  addressFromPublicKey,
  GrouplessAccount
} from '@alephium/web3'
import { decode as cborDecode } from 'cbor2'
import * as elliptic from 'elliptic'
import { AsnParser } from '@peculiar/asn1-schema'
import { ECDSASigValue } from '@peculiar/asn1-ecc'
import * as BN from 'bn.js'

export interface PasskeyAccount extends GrouplessAccount {
  rawId: HexString
}

export class PasskeyAlephiumProvider extends SignerProvider {
  constructor(
    readonly account: PasskeyAccount,
    readonly nodeProvider: NodeProvider,
    readonly explorerProvider: ExplorerProvider | undefined,
    readonly txBuilder: TransactionBuilder = TransactionBuilder.from(nodeProvider)
  ) {
    super();
  }

  async unsafeGetSelectedAccount(): Promise<PasskeyAccount> {
    return this.account
  }

  override getSelectedAccount(): Promise<Account> {
    return this.unsafeGetSelectedAccount()
  }

  private async getAccountByAddress(address: string): Promise<PasskeyAccount> {
    const account = await this.unsafeGetSelectedAccount()
    if (account.address !== address) {
      throw new Error(`Invalid selected address ${address}`)
    }
    return account
  }

  private async _signAndSubmitTransferTx(account: PasskeyAccount, buildResult: Omit<SignTransferTxResult, 'signature'>) {
    const signatures = await sign(account, buildResult.txId)
    await this.nodeProvider.multisig.postMultisigSubmit({
      unsignedTx: buildResult.unsignedTx,
      signatures: signatures
    })
    return { ...buildResult, signature: signatures.join('') }
  }

  private async signAndSubmitTransferTxs(account: PasskeyAccount, buildResults: Omit<SignTransferTxResult, 'signature'>[]) {
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
      signerKeyType: 'gl-webauthn',
      destinations: params.destinations.map((d) => ({
        address: d.address,
        attoAlphAmount: d.attoAlphAmount.toString()
      }))
    }, account.publicKey)
    if ('fundingTxs' in buildResult && buildResult.fundingTxs !== undefined) {
      await this.signAndSubmitTransferTxs(account, buildResult.fundingTxs)
    }
    return await this._signAndSubmitTransferTx(account, buildResult)
  }

  async signAndSubmitDeployContractTx(params: SignDeployContractTxParams): Promise<SignDeployContractTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResult = await this.txBuilder.buildDeployContractTx({
      signerAddress: account.address,
      signerKeyType: 'gl-webauthn',
      bytecode: params.bytecode,
      initialAttoAlphAmount: params.initialAttoAlphAmount?.toString(),
      initialTokenAmounts: toApiTokens(params.initialTokenAmounts),
      issueTokenAmount: params.issueTokenAmount?.toString(),
      issueTokenTo: params.issueTokenTo,
      gasPrice: params.gasPrice?.toString(),
    }, account.publicKey)
    if ('fundingTxs' in buildResult && buildResult.fundingTxs !== undefined) {
      await this.signAndSubmitTransferTxs(account, buildResult.fundingTxs)
    }
    const signatures = await sign(account, buildResult.txId)
    await this.nodeProvider.multisig.postMultisigSubmit({
      unsignedTx: buildResult.unsignedTx,
      signatures: signatures
    })
    return {
      ...buildResult,
      signature: signatures.join(''),
      contractId: binToHex(contractIdFromAddress(buildResult.contractAddress))
    }
  }

  async signAndSubmitExecuteScriptTx(params: SignExecuteScriptTxParams): Promise<SignExecuteScriptTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const buildResult = await this.txBuilder.buildExecuteScriptTx({
      signerAddress: account.address,
      signerKeyType: 'gl-webauthn',
      bytecode: params.bytecode,
      attoAlphAmount: params.attoAlphAmount?.toString(),
      tokens: toApiTokens(params.tokens),
      gasPrice: params.gasPrice?.toString(),
      gasEstimationMultiplier: params.gasEstimationMultiplier
    }, account.publicKey)
    if ('fundingTxs' in buildResult && buildResult.fundingTxs !== undefined) {
      await this.signAndSubmitTransferTxs(account, buildResult.fundingTxs)
    }
    const signatures = await sign(account, buildResult.txId)
    await this.nodeProvider.multisig.postMultisigSubmit({
      unsignedTx: buildResult.unsignedTx,
      signatures: signatures
    })
    return {
      ...buildResult,
      signature: signatures.join(''),
    }
  }

  async signAndSubmitUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const unsignedTx = TransactionBuilder.buildUnsignedTx(params)
    const signatures = await sign(account, unsignedTx.txId)
    await this.nodeProvider.multisig.postMultisigSubmit({ unsignedTx: unsignedTx.unsignedTx, signatures: signatures })
    return { ...unsignedTx, signature: signatures.join('') }
  }

  async signUnsignedTx(params: SignUnsignedTxParams): Promise<SignUnsignedTxResult> {
    const account = await this.getAccountByAddress(params.signerAddress)
    const unsignedTx = TransactionBuilder.buildUnsignedTx(params)
    const signatures = await sign(account, unsignedTx.txId)
    return { ...unsignedTx, signature: signatures.join('') }
  }

  async signAndSubmitChainedTx(_: SignChainedTxParams[]): Promise<SignChainedTxResult[]> {
    throw new Error("Not implemented")
  }

  async signMessage(_: SignMessageParams): Promise<SignMessageResult> {
    throw new Error("Not implemented")
  }
}

export function isWalletExist(name: string): boolean {
  return localStorage.getItem(name) !== null
}

const curve = new elliptic.ec('p256')

function storeWallet(name: string, wallet: PasskeyAccount) {
  if (localStorage.getItem(name) !== null) throw new Error(`Wallet ${name} already exist`)
  const json = JSON.stringify(wallet)
  localStorage.setItem(name, json)
}

function getWallet(name: string): PasskeyAccount {
  const value = localStorage.getItem(name)
  if (value === null) throw new Error(`Wallet ${name} does not exist`)
  return JSON.parse(value)
}

export function getWalletAddress(name: string): string {
  return encodePasskeyToBase58(hexToBinUnsafe(getWallet(name).publicKey))
}

function encodePasskeyToBase58(publicKey: Uint8Array): string {
  return addressFromPublicKey(binToHex(publicKey), 'gl-webauthn')
}

async function sign(account: PasskeyAccount, txId: HexString) {
  const bytes = hexToBinUnsafe(txId)
  const credential = await window.navigator.credentials.get({
    publicKey: {
      challenge: bytes,
      userVerification: "preferred",
      allowCredentials: [{ id: hexToBinUnsafe(account.rawId), type: "public-key" }]
    },
  }) as PublicKeyCredential
  const response = credential.response as AuthenticatorAssertionResponse
  const signature = parseSignature(new Uint8Array(response.signature))

  const authenticatorData = new Uint8Array(response.authenticatorData)
  const clientDataJSON = new Uint8Array(response.clientDataJSON)

  const array = encodeWebauthnPayload(authenticatorData, clientDataJSON)
  array.push(signature)
  return array.map((bs) => binToHex(bs))
}

function encodeWebauthnPayload(authenticatorData: Uint8Array, clientDataJSON: Uint8Array) {
  const clientDataStr = new TextDecoder('utf-8').decode(clientDataJSON)
  const index0 = clientDataStr.indexOf("challenge") + 12
  const index1 = clientDataStr.indexOf('"', index0 + 1)
  const clientDataPrefixStr = clientDataStr.slice(0, index0)
  const clientDataSuffixStr = clientDataStr.slice(index1, clientDataStr.length)

  const encoder = new TextEncoder()
  const clientDataPrefix = encoder.encode(clientDataPrefixStr)
  const clientDataSuffix = encoder.encode(clientDataSuffixStr)

  const bytes1 = codec.byteStringCodec.encode(authenticatorData)
  const bytes2 = codec.byteStringCodec.encode(clientDataPrefix)
  const bytes3 = codec.byteStringCodec.encode(clientDataSuffix)

  const payloadLength = bytes1.length + bytes2.length + bytes3.length
  const lengthPrefix = codec.i32Codec.encode(payloadLength)
  const length = lengthPrefix.length + payloadLength
  const totalLength = Math.ceil(length / 64) * 64
  const padding = new Uint8Array(totalLength - length).fill(0)
  const payload = concatBytes([lengthPrefix, bytes1, bytes2, bytes3, padding])
  console.log(`${binToHex(payload)}`)
  return Array.from({ length: payload.length / 64 }, (_, i) => payload.subarray(i * 64, (i + 1) * 64))
}

function parseSignature(signature: Uint8Array): Uint8Array {
  const parsedSignature = AsnParser.parse(signature, ECDSASigValue)
  let rBytes = new Uint8Array(parsedSignature.r)
  let sBytes = new Uint8Array(parsedSignature.s)

  if (shouldRemoveLeadingZero(rBytes)) {
    rBytes = rBytes.slice(1)
  }

  if (shouldRemoveLeadingZero(sBytes)) {
    sBytes = sBytes.slice(1)
  }

  const halfCurveOrder = curve.n!.shrn(1)
  const s = new BN.BN(sBytes)
  if (s.gt(halfCurveOrder)) {
    sBytes = new Uint8Array(curve.n!.sub(s).toArray('be', 32))
  }
  return new Uint8Array([...rBytes, ...sBytes])
}

// https://crypto.stackexchange.com/questions/57731/ecdsa-signature-rs-to-asn1-der-encoding-question
function shouldRemoveLeadingZero(bytes: Uint8Array): boolean {
  return bytes[0] === 0x0 && (bytes[1]! & (1 << 7)) !== 0
}

export async function createPasskeyAccount(walletName: string) {
  if (isWalletExist(walletName)) throw new Error(`Wallet ${walletName} already exist`)
  const credential = await navigator.credentials.create({
    publicKey: {
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        userVerification: 'preferred',
      },
      attestation: 'direct',
      challenge: window.crypto.getRandomValues(new Uint8Array(16)),
      rp: { name: 'alephium-passkey-wallet' },
      user: {
        name: walletName,
        displayName: walletName,
        id: window.crypto.getRandomValues(new Uint8Array(16))
      }
    }
  }) as PublicKeyCredential
  const response = credential.response as AuthenticatorAttestationResponse
  if (response.attestationObject === undefined) {
    throw new Error(`Expected an attestation response, but got ${credential.response}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attestationObject = cborDecode(new Uint8Array(response.attestationObject)) as any
  const authData = attestationObject.authData as Uint8Array

  const dataView = new DataView(new ArrayBuffer(2))
  const idLenBytes = authData.slice(53, 55)
  idLenBytes.forEach((value, index) => dataView.setUint8(index, value))
  const credentialIdLength = dataView.getUint16(0)
  const publicKeyBytes = authData.slice(55 + credentialIdLength)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const publicKeyObject = cborDecode(new Uint8Array(publicKeyBytes)) as any
  const publicKey = compressPublicKey(new Uint8Array(publicKeyObject.get(-2)), new Uint8Array(publicKeyObject.get(-3)))
  const address = encodePasskeyToBase58(publicKey)
  const account: PasskeyAccount = {
    address,
    publicKey: binToHex(publicKey),
    rawId: binToHex(new Uint8Array(credential.rawId)),
    keyType: 'gl-webauthn'
  }
  storeWallet(walletName, account)
}

function compressPublicKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  const key = curve.keyFromPublic({ x: binToHex(x), y: binToHex(y) }, 'hex')
  return hexToBinUnsafe(key.getPublic(true, 'hex'))
}
