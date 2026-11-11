// Names and titles as they are set on a screen: a `backticked` word is code, and a dotted name
// may break after its dots, not in the middle of a word.
import { coded } from "./words.ts";

/** A name that breaks only after a dot ("review.maintainability" is two lines at worst, never "maintainabilit / y"). */
export const Breakable = ({ name }: { name: string }) =>
  name.split(".").map((part, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of a name never change order
    <span key={i}>
      {i > 0 ? (
        <>
          .<wbr />
        </>
      ) : null}
      {part}
    </span>
  ));

/** A sentence or a title with its `backticked` words set as code. */
export const Coded = ({ sentence }: { sentence: string }) =>
  coded(sentence).map((part) => (part.code ? <code key={part.text}>{part.text}</code> : part.text));
