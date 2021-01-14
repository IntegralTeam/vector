import { WithdrawCommitment } from "@connext/vector-contracts";
import { getRandomBytes32, getSignerAddressFromPublicIdentifier } from "@connext/vector-utils";
import {
  CreateTransferParams,
  ResolveTransferParams,
  FullChannelState,
  Result,
  DEFAULT_TRANSFER_TIMEOUT,
  FullTransferState,
  WithdrawState,
  EngineParams,
  IChannelSigner,
  ChainAddresses,
  RouterSchemas,
  TransferNames,
  TransferName,
  IVectorChainReader,
  EngineError,
  jsonifyError,
} from "@connext/vector-types";
import { BigNumber } from "@ethersproject/bignumber";
import { AddressZero } from "@ethersproject/constants";
import { getAddress } from "@ethersproject/address";

import { ParameterConversionError } from "./errors";

export async function convertConditionalTransferParams(
  params: EngineParams.ConditionalTransfer,
  signer: IChannelSigner,
  channel: FullChannelState,
  chainAddresses: ChainAddresses,
  chainReader: IVectorChainReader,
): Promise<Result<CreateTransferParams, EngineError>> {
  const { channelAddress, amount, assetId, recipient, details, type, timeout, meta: providedMeta } = params;

  const recipientChainId = params.recipientChainId ?? channel.networkContext.chainId;
  const recipientAssetId = getAddress(params.recipientAssetId ?? params.assetId);
  const channelCounterparty = signer.address === channel.alice ? channel.bob : channel.alice;

  if (recipient === signer.publicIdentifier && recipientChainId === channel.networkContext.chainId) {
    // If signer is also the receipient on same chain/network
    return Result.fail(
      new ParameterConversionError(
        ParameterConversionError.reasons.CannotSendToSelf,
        channelAddress,
        signer.publicIdentifier,
        {
          params,
        },
      ),
    );
  }

  // If the recipient is the channel counterparty, no default routing
  // meta needs to be created, otherwise create the default routing meta.
  // NOTE: While the engine and protocol do not care about the structure
  // of the meta, this is where several relevant default values are
  // set for the higher level modules to parse
  let baseRoutingMeta: RouterSchemas.RouterMeta | undefined = undefined;
  if (recipient && getSignerAddressFromPublicIdentifier(recipient) !== channelCounterparty) {
    const requireOnline = providedMeta?.requireOnline ?? true; // true by default
    baseRoutingMeta = {
      requireOnline,
      routingId: providedMeta?.routingId ?? getRandomBytes32(),
      path: [{ recipient, recipientChainId, recipientAssetId }],
    };
  }

  // TODO: transfers should be allowed to go to participants outside of the
  // channel (i.e. some dispute recovery address). This should be passed in
  // via the transfer params as a `recoveryAddress` variable
  // const transferStateRecipient = recipient ? getSignerAddressFromPublicIdentifier(recipient) : channelCounterparty;

  // Get the transfer information from the chain reader
  const registryRes = !type.startsWith(`0x`)
    ? await chainReader.getRegisteredTransferByName(
        type as TransferName,
        chainAddresses[channel.networkContext.chainId].transferRegistryAddress,
        channel.networkContext.chainId,
      )
    : await chainReader.getRegisteredTransferByDefinition(
        type,
        chainAddresses[channel.networkContext.chainId].transferRegistryAddress,
        channel.networkContext.chainId,
      );
  if (registryRes.isError) {
    return Result.fail(
      new ParameterConversionError(
        ParameterConversionError.reasons.FailedToGetRegisteredTransfer,
        channelAddress,
        signer.publicIdentifier,
        { params, registryError: jsonifyError(registryRes.getError()!) },
      ),
    );
  }
  const { definition } = registryRes.getValue()!;

  // Construct initial state
  const transferInitialState = {
    ...details,
  };

  return Result.ok({
    channelAddress,
    balance: { to: [signer.address, channelCounterparty], amount: [amount.toString(), "0"] },
    assetId,
    transferDefinition: definition,
    transferInitialState,
    timeout: timeout || DEFAULT_TRANSFER_TIMEOUT.toString(),
    meta: {
      ...(baseRoutingMeta ?? {}),
      ...(providedMeta ?? {}),
    },
  });
}

export function convertResolveConditionParams(
  params: EngineParams.ResolveTransfer,
  transfer: FullTransferState,
): Result<ResolveTransferParams, EngineError> {
  const { channelAddress, transferResolver, meta } = params;

  return Result.ok({
    channelAddress,
    transferId: transfer.transferId,
    transferResolver,
    meta: { ...(transfer.meta ?? {}), ...(meta ?? {}) },
  });
}

export async function convertWithdrawParams(
  params: EngineParams.Withdraw,
  signer: IChannelSigner,
  channel: FullChannelState,
  chainAddresses: ChainAddresses,
  chainReader: IVectorChainReader,
): Promise<Result<CreateTransferParams, EngineError>> {
  const { channelAddress, fee, callTo, callData, meta } = params;
  const assetId = getAddress(params.assetId);
  const recipient = getAddress(params.recipient);

  // If recipient is AddressZero, throw
  if (recipient === AddressZero) {
    return Result.fail(
      new ParameterConversionError(
        ParameterConversionError.reasons.WithdrawToZero,
        channelAddress,
        signer.publicIdentifier,
        { params },
      ),
    );
  }

  // If there is a fee being charged, add the fee to the amount.
  const amount = fee ? BigNumber.from(params.amount).add(fee).toString() : params.amount;

  const commitment = new WithdrawCommitment(
    channel.channelAddress,
    channel.alice,
    channel.bob,
    params.recipient,
    assetId,
    // Important: Use params.amount here which doesn't include fee!!
    params.amount,
    // Use channel nonce as a way to keep withdraw hashes unique
    channel.nonce.toString(),
    callTo,
    callData,
  );

  let initiatorSignature: string;
  try {
    initiatorSignature = await signer.signMessage(commitment.hashToSign());
  } catch (err) {
    return Result.fail(
      new ParameterConversionError(
        ParameterConversionError.reasons.CouldNotSignWithdrawal,
        channelAddress,
        signer.publicIdentifier,
        {
          signatureError: err.message,
          params,
          commitment: commitment.toJson(),
        },
      ),
    );
  }

  const channelCounterparty = channel.alice === signer.address ? channel.bob : channel.alice;

  const transferInitialState: WithdrawState = {
    initiatorSignature,
    initiator: signer.address,
    responder: channelCounterparty,
    data: commitment.hashToSign(),
    nonce: channel.nonce.toString(),
    fee: fee ?? "0",
    callTo: callTo ?? AddressZero,
    callData: callData ?? "0x",
  };

  // Get the transfer information from the chain reader
  const registryRes = await chainReader.getRegisteredTransferByName(
    TransferNames.Withdraw,
    chainAddresses[channel.networkContext.chainId].transferRegistryAddress,
    channel.networkContext.chainId,
  );
  if (registryRes.isError) {
    return Result.fail(
      new ParameterConversionError(
        ParameterConversionError.reasons.FailedToGetRegisteredTransfer,
        channelAddress,
        signer.publicIdentifier,
        { params, registryError: jsonifyError(registryRes.getError()!) },
      ),
    );
  }
  const { definition } = registryRes.getValue()!;

  return Result.ok({
    channelAddress,
    balance: {
      amount: [amount, "0"],
      to: [recipient, channelCounterparty],
    },
    assetId,
    transferDefinition: definition,
    transferInitialState,
    timeout: DEFAULT_TRANSFER_TIMEOUT.toString(),
    // Note: we MUST include withdrawNonce in meta. The counterparty will NOT have the same nonce on their end otherwise.
    meta: {
      ...(meta ?? {}),
      withdrawNonce: channel.nonce.toString(),
    },
  });
}
