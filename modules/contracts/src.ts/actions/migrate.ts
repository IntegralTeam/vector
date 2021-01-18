import { EtherSymbol, Zero } from "@ethersproject/constants";
import { JsonRpcProvider, JsonRpcSigner } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { formatEther } from "@ethersproject/units";
import { Argv } from "yargs";

import { AddressBook, getAddressBook } from "../addressBook";
import { cliOpts, logger } from "../constants";

import { deployContracts } from "./deployContracts";
import { registerTransfer } from "./registerTransfer";

export const migrate = async (signer: JsonRpcSigner | Wallet, addressBook: AddressBook, log = logger.child({})): Promise<void> => {
  // Setup env & log initial state
  const chainId = ((await signer.provider.getNetwork()).chainId).toString();
  const address = await signer.getAddress();
  const balance = await signer.getBalance();
  const nonce = await signer.getTransactionCount();
  const providerUrl = (signer.provider as JsonRpcProvider).connection.url;

  log.info(`Preparing to migrate contracts to provider ${providerUrl} w chainId: ${chainId}`);
  log.info(`Deployer address=${address} nonce=${nonce} balance=${formatEther(balance)}`);

  if (balance.eq(Zero)) {
    throw new Error(`Account ${address} has zero balance on chain ${chainId}, aborting migration`);
  }

  ////////////////////////////////////////
  // Run the migration

  // Don't migrate to mainnet until disputes are working & major vulnerabilities are mitigated
  if (chainId === "1") {
    throw new Error(`Contract migration for chain ${chainId} is not supported yet`);

    // Default: run testnet migration
  } else {
    await deployContracts(
      signer,
      addressBook,
      [
        ["TestToken", []],
        ["ChannelMastercopy", []],
        ["ChannelFactory", ["ChannelMastercopy", Zero]],
        ["HashlockTransfer", []],
        ["Withdraw", []],
        ["TransferRegistry", []],
      ],
      log,
    );
    await registerTransfer("Withdraw", signer, addressBook, log);
    await registerTransfer("HashlockTransfer", signer, addressBook, log);
  }

  ////////////////////////////////////////
  // Print summary
  log.info("All done!");
  const spent = formatEther(balance.sub(await signer.getBalance()));
  const nTx = (await signer.getTransactionCount()) - nonce;
  log.info(`Sent ${nTx} transaction${nTx === 1 ? "" : "s"} & spent ${EtherSymbol} ${spent}`);
};

export const migrateCommand = {
  command: "migrate",
  describe: "Migrate contracts",
  builder: (yargs: Argv): Argv => {
    return yargs
      .option("a", cliOpts.addressBook)
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
    await migrate(signer, addressBook, logger.child({ level }));
  },
};
