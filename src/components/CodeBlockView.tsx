import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

const CODE_LANGUAGES = [
  ["python", "Python"],
  ["javascript", "JavaScript"],
  ["typescript", "TypeScript"],
  ["bash", "Bash / Shell"],
  ["rust", "Rust"],
  ["json", "JSON"],
  ["xml", "HTML / XML"],
  ["css", "CSS"],
  ["markdown", "Markdown"],
  ["sql", "SQL"],
  ["yaml", "YAML"],
] as const;

export function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  const language = String(node.attrs.language ?? "");
  return (
    <NodeViewWrapper className="code-block-shell">
      <div className="code-block-controls" contentEditable={false}>
        <select aria-label="區塊類型" value={language} onChange={(event) => updateAttributes({ language: event.target.value || null })}>
          <option value="">Plain Text</option>
          {CODE_LANGUAGES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </div>
      <pre><NodeViewContent /></pre>
    </NodeViewWrapper>
  );
}
