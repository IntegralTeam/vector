import { RegisteredTransfer, tidy } from "@connext/vector-types";
import { JsonRpcProvider, JsonRpcSigner } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { Argv } from "yargs";

import { AddressBook, getAddressBook } from "../addressBook";
import { cliOpts, logger } from "../constants";

export const registerTransfer = async (
  transferName: string,
  signer: JsonRpcSigner | Wallet,
  addressBook: AddressBook,
  log = logger.child({}),
): Promise<void> => {
  const address = await signer.getAddress();
  log.info(`Preparing to add ${transferName} to registry (Sender=${address})`);

  const registry = addressBook.getContract("TransferRegistry").connect(signer);
  const transfer = addressBook.getContract(transferName).connect(signer);

  const registered = await registry.getTransferDefinitions();
  const transferInfo = await transfer.getRegistryInformation();

  // Check if transfer is already in registry
  const entry = registered.find((info: RegisteredTransfer) => info.name === transferName);
  if (entry && entry.definition === transfer.address) {
    log.info({ transferName }, `Transfer has already been registered`);
    return;
  }

  // Check for the case where the registered transfer doesnt have the
  // right address
  if (entry && entry.definition !== transfer.address) {
    // Remove transfer from registry
    log.info(
      { transferName, registered: entry.definition, latest: transfer.address },
      `Transfer has stale registration, removing and updating`,
    );
    const removal = await registry.removeTransferDefinition(transferName);
    log.info({ hash: removal.hash }, "Removal tx broadcast");
    await removal.wait();
    log.info("Removal tx mined");
  }

  log.info({ transferName, latest: transfer.address }, `Getting registry information`);

  // Sanity-check: tidy return value
  const cleaned = {
    name: transferInfo.name,
    definition: transferInfo.definition,
    resolverEncoding: tidy(transferInfo.resolverEncoding),
    stateEncoding: tidy(transferInfo.stateEncoding),
    encodedCancel: transferInfo.encodedCancel,
  };
  log.info(`Adding transfer to registry ${JSON.stringify(cleaned, null, 2)}`);
  const response = await registry.addTransferDefinition(cleaned);
  log.info(`Added: ${response.hash}`);
  await response.wait();
  log.info(`Tx mined, successfully added ${cleaned.name} on ${cleaned.definition}`);
};

export const registerTransferCommand = {
  command: "register-transfer",
  describe: "Adds transfer to registry",
  builder: (yargs: Argv): Argv => {
    return yargs
      .option("t", cliOpts.transferName)
      .option("a", cliOpts.addressBook)
      .option("m", cliOpts.mnemonic)
      .option("p", cliOpts.ethProvider)
      .option("s", cliOpts.silent);
  },
  handler: async (argv: { [key: string]: any } & Argv["argv"]): Promise<void> => {
    const signer = new JsonRpcProvider(argv.ethProvider).getSigner();
    const addressBook = getAddressBook(argv.addressBook, (await signer.provider.getNetwork()).chainId.toString());
    const level = argv.silent ? "silent" : "info";
    await registerTransfer(argv.transferName, signer, addressBook, logger.child({ level }));
  },
};
