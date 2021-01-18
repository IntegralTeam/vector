import { Contract } from "@ethersproject/contracts";
import { JsonRpcProvider, JsonRpcSigner } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { Argv } from "yargs";

import { AddressBook, getAddressBook } from "../addressBook";
import { TestChannel, VectorChannel } from "../artifacts";
import { cliOpts, logger } from "../constants";

export const createChannel = async (
  bobAddress: string,
  alice: JsonRpcSigner | Wallet,
  addressBook: AddressBook,
  log = logger.child({}),
  test = false,
): Promise<Contract> => {
  const aliceAddress = await alice.getAddress();
  log.info(`Preparing to create a channel for alice=${aliceAddress} and bob=${bobAddress}`);
  const channelFactory = addressBook.getContract("ChannelFactory");
  const channelAddress = await channelFactory.getChannelAddress(aliceAddress, bobAddress);
  const tx = await channelFactory.createChannel(aliceAddress, bobAddress);
  await tx.wait();
  log.info(`Successfully created a channel at ${channelAddress}`);
  // Save this channel address in case we need it later
  addressBook.setEntry(`VectorChannel-${aliceAddress.substring(2, 6)}-${bobAddress.substring(2, 6)}`, {
    address: channelAddress,
    args: [aliceAddress, bobAddress],
    txHash: tx.hash,
  });
  return test
    ? new Contract(channelAddress, TestChannel.abi, alice)
    : new Contract(channelAddress, VectorChannel.abi, alice);
};

export const createChannelCommand = {
  command: "create-channel",
  describe: "Creates a new channel for the two counterparties",
  builder: (yargs: Argv): Argv => {
    return yargs
      .option("a", cliOpts.addressBook)
      .option("c", cliOpts.bobAddress)
      .option("m", cliOpts.mnemonic)
      .option("p", cliOpts.ethProvider)
      .option("s", cliOpts.silent);
  },
  handler: async (argv: { [key: string]: any } & Argv["argv"]): Promise<void> => {
    const signer = new JsonRpcProvider(argv.ethProvider).getSigner()
    const addressBook = getAddressBook(
      argv.addressBook,
      (await signer.provider.getNetwork()).chainId.toString(),
    );
    const level = argv.silent ? "silent" : "info";
    await createChannel(argv.transferName, signer, addressBook, logger.child({ level }));
  },
};
