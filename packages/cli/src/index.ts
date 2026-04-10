#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("launchpad")
  .description("LaunchPad CLI — local development tools for LaunchPad projects")
  .version("0.1.0");

program
  .command("dev")
  .description("Start dev server with LaunchPad environment variables")
  .action(() => {
    console.log("launchpad dev — coming soon");
  });

program
  .command("validate")
  .description("Run validation guards locally")
  .action(() => {
    console.log("launchpad validate — coming soon");
  });

program
  .command("status")
  .description("Show project status")
  .action(() => {
    console.log("launchpad status — coming soon");
  });

program
  .command("add <extension>")
  .description("Add an extension (stripe, resend, upstash)")
  .action((extension: string) => {
    console.log(`launchpad add ${extension} — coming soon`);
  });

program
  .command("db:reset")
  .description("Reset the staging database")
  .action(() => {
    console.log("launchpad db:reset — coming soon");
  });

program
  .command("logs")
  .description("Tail recent deploy and runtime logs")
  .action(() => {
    console.log("launchpad logs — coming soon");
  });

program.parse();
