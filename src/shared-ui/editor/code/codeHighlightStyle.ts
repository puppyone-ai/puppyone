import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const puppyCodeHighlightStyle = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], class: "cm-code-comment" },
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.operatorKeyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    class: "cm-code-keyword",
  },
  { tag: [tags.string, tags.docString, tags.character, tags.attributeValue], class: "cm-code-string" },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom], class: "cm-code-constant" },
  { tag: [tags.regexp, tags.escape, tags.color], class: "cm-code-special" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: "cm-code-type" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: "cm-code-function" },
  { tag: [tags.propertyName, tags.attributeName], class: "cm-code-property" },
  { tag: [tags.operator, tags.logicOperator, tags.compareOperator, tags.arithmeticOperator], class: "cm-code-operator" },
  { tag: [tags.meta, tags.annotation, tags.processingInstruction], class: "cm-code-meta" },
  { tag: tags.invalid, class: "cm-code-invalid" },
]);
