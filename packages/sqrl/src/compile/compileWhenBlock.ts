/**
 * Copyright 2018 Twitter, Inc.
 * Licensed under the Apache License, Version 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */
import { WhenAst, CallStatementAst } from "../ast/Ast";
import SqrlAst from "../ast/SqrlAst";
import { SqrlParserState } from "./SqrlParserState";
import invariant from "../jslib/invariant";
import { buildSqrlError, sqrlInvariant } from "../api/parse";

export function compileWhenBlock(state: SqrlParserState, ast: WhenAst) {
  if (ast.rules.type !== "rules") {
    throw new Error("Expected rules for when statement");
  }

  const ruleNames = ast.rules.rules.map(feature => feature.value);
  const whenCauseAst = state.newGlobal(
    ast,
    SqrlAst.call("_buildWhenCause", [
      SqrlAst.constant(ruleNames),
      SqrlAst.list(
        ...ruleNames.map(name => {
          const spec = state.getRuleSpec(ast, name);
          return SqrlAst.branch(
            SqrlAst.feature(name),
            SqrlAst.list(
              ...spec.features.map(ruleReasonFeature => {
                return SqrlAst.feature(ruleReasonFeature);
              })
            )
          );
        })
      )
    ])
  );

  ast.statements.forEach((statement: CallStatementAst) => {
    if (statement.type !== "call") {
      throw buildSqrlError(
        statement,
        "Only call statements are valid in WHEN blocks for now"
      );
    }
    const { func } = statement;
    const props = state.instance.getProps(func);

    const args = props.args;
    if (!Array.isArray(args)) {
      // This is just to check if it has whenCause added
      throw new Error(
        "Statements used in WHEN blocks must have defined arguments"
      );
    }

    const whenArg = statement.args[1];
    invariant(
      statement.args.length >= 2 &&
        statement.args[0].type === "state" &&
        whenArg.type === "whenCause" &&
        !whenArg.slotName,
      "Expected whenCause to automatically be inserted by AstTransformer"
    );

    sqrlInvariant(
      statement,
      state.instance.isStatement(func) &&
        props.stateArg &&
        props.whenCauseArg,
      `Function '${func}' must have a state and when context argument for use in a WHEN block`
    );

    state.pushStatement(
      SqrlAst.branch(
        whenCauseAst,
        SqrlAst.call(func, [
          { type: "state" },
          { type: "whenCause", slotName: whenCauseAst.slotName },
          ...statement.args.slice(2)
        ])
      )
    );
  });
}
