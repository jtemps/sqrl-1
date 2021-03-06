/**
 * Copyright 2018 Twitter, Inc.
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */
// tslint:disable:no-console

import jsonStableStringify = require("fast-stable-stringify");
import { Writable } from "stream";
import {
  serializeExpr,
  FeatureMap,
  FunctionInfo,
  Execution,
  CompiledExecutable,
  createSimpleContext
} from "sqrl";
import { invariant, SqrlObject, mapObject } from "sqrl-common";
import * as csvStringify from "csv-stringify";
import { CliError } from "./CliError";
import { CliManipulator } from "sqrl-cli-functions";
import { generateDotFile } from "./generateDot";

// @todo: This could be made a command line option
const MAX_TABLE_ROWS = 50;

export interface CliOutputOptions {
  stdout?: Writable;
  features?: string[];
  onlyBlocked?: boolean;
}

export abstract class CliOutput {
  constructor(protected stdout: Writable) {}
  close() {
    return;
  }
  error(err: Error) {
    if (err instanceof CliError) {
      console.error("Error: " + err.message);
    } else {
      console.error(err.stack);
    }
  }
  sourceRecompiling() {
    return;
  }
  sourceUpdated() {
    console.error("Source updated.");
  }
  sourceRecompileError(err: Error) {
    console.error("Source recompile failed: " + err.toString());
  }
  printFunctions(info: FunctionInfo[]) {
    throw new CliError("Output mode not supported");
  }
}

export abstract class CliCompileOutput extends CliOutput {
  abstract compiled(compiledOutput: CompiledExecutable): Promise<void>;
}

export class CliExprOutput extends CliCompileOutput {
  async compiled(compiledOutput: CompiledExecutable) {
    this.stdout.write(
      jsonStableStringify({
        slotExprs: compiledOutput
          .getSlotExprs()
          .map(expr => serializeExpr(expr)),
        slotNames: compiledOutput.getSlotNames()
      }) + "\n"
    );
  }
}

export class CliSlotJsOutput extends CliCompileOutput {
  async compiled(compiledOutput: CompiledExecutable) {
    console.log(
      jsonStableStringify({
        ...compiledOutput.getExecutableSpec(),
        features: compiledOutput.getFeatureDocs()
      })
    );
  }
}

export class CliDotOutput extends CliCompileOutput {
  async compiled(compiledOutput: CompiledExecutable) {
    console.log(
      generateDotFile(createSimpleContext(), compiledOutput, [
        "SqrlExecutionComplete"
      ])
    );
  }
}

export abstract class CliActionOutput extends CliOutput {
  abstract startStream();
  abstract action(
    manipulator: CliManipulator,
    execution: Execution,
    loggedFeatures: FeatureMap
  );
}

export class CliJsonOutput extends CliActionOutput {
  constructor(private options: CliOutputOptions) {
    super(options.stdout);
  }
  startStream() {
    /* do nothing */
  }
  action(
    manipulator: CliManipulator,
    execution: Execution,
    loggedFeatures: FeatureMap
  ) {
    if (this.options.onlyBlocked) {
      if (manipulator.wasBlocked()) {
        return;
      }
    }
    console.log(JSON.stringify(loggedFeatures));
  }
  printFunctions(info: FunctionInfo[]) {
    console.log(JSON.stringify(info));
  }
}

export class CliCsvOutput extends CliActionOutput {
  private features: string[];
  private stringifier: csvStringify.Stringifier;

  constructor(private options: CliOutputOptions) {
    super(options.stdout || process.stdout);
    invariant(
      Array.isArray(options.features) && options.features.length,
      "At-least one feature output required for CSV"
    );
    this.features = options.features;
  }
  startStream() {
    this.stringifier = csvStringify({});
    this.stringifier.pipe(this.stdout);
    this.stringifier.write(this.features);
  }
  action(
    manipulator: CliManipulator,
    execution: Execution,
    loggedFeatures: FeatureMap
  ) {
    if (this.options.onlyBlocked) {
      if (manipulator.wasBlocked()) {
        return;
      }
    }

    const row = this.features.map(name => {
      return SqrlObject.ensureBasic(loggedFeatures[name]);
    });

    if (this.stringifier) {
      this.stringifier.write(row);
    } else {
      this.startStream();
      this.stringifier.write(row);
      this.close();
    }
  }

  close() {
    this.stringifier.end();
  }
}

export class CliTableOutput extends CliActionOutput {
  private rows: {
    [key: string]: any;
  }[] = [];
  private features: string[];
  private headers: Set<string> = new Set();
  private streaming = false;
  private includeLogMessages = false;

  constructor(private options: CliOutputOptions) {
    super(options.stdout || process.stdout);
    invariant(
      console.hasOwnProperty("table"),
      "Table output requires a Node.js version with console.table support"
    );
    this.features = options.features;
  }
  startStream() {
    this.streaming = true;
  }
  action(
    manipulator: CliManipulator,
    execution: Execution,
    loggedFeatures: FeatureMap
  ) {
    if (this.options.onlyBlocked) {
      if (manipulator.wasBlocked()) {
        return;
      }
    }

    if (this.includeLogMessages) {
      manipulator.logged.forEach(message => {
        console.error(message);
      });
    }

    this.rows.push(mapObject(loggedFeatures, val => val.getBasicValue()));
    Object.keys(loggedFeatures).forEach(name => {
      this.headers.add(name);
    });

    if (!this.streaming || this.rows.length === MAX_TABLE_ROWS) {
      this.writeTable();
    }
  }

  private writeTable() {
    // Put the selected features first, then any additional logged features sorted
    const headers = this.features.concat(
      Array.from(this.headers)
        .filter(feature => !this.features.includes(feature))
        .sort()
    );

    if (this.rows.length) {
      (console as any).table(this.rows, headers);
    }
    this.rows = [];
    this.headers = new Set();
  }

  close() {
    this.writeTable();
    this.streaming = false;
  }
}
