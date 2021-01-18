import { JsonRpcProvider } from "@ethersproject/providers";
import { Argv } from "yargs";

import { cliOpts, logger } from "../constants";

export const displayAccounts = async (ethProvider: string, log = logger.child({})): Promise<void> => {
  const alice = new JsonRpcProvider(ethProvider).getSigner();
  const bob = new JsonRpcProvider(ethProvider).getSigner(1);
  const rando = new JsonRpcProvider(ethProvider).getSigner(2);

  const aliceAddres = await alice.getAddress();
  const bobAddres = await bob.getAddress();
  const randoAddres = await rando.getAddress();
  log.info({ alice: aliceAddres, recommended: "1 ETH" }, "Alice");
  log.info({ bob: bobAddres, recommended: "0.5 ETH" }, "Bob");
  log.info({ rando: randoAddres, recommended: "0.1 ETH" }, "Rando");
};

export const displayCommand = {
  command: "display-accounts",
  describe: "Display contract test accounts",
  builder: (yargs: Argv): Argv => {
    return yargs.option("m", cliOpts.mnemonic);
  },
  handler: async (argv: { [key: string]: any } & Argv["argv"]): Promise<void> => {
    await displayAccounts(argv.ethProvider, logger.child({ level: "info" }));
  },
};
