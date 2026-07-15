const { validateContent, formatValidationIssue } = require('./gateway/engine/contentValidator.js');

const tests = [
  { name: 'valid HTML', content: '<div><p>hello</p></div>', expect: 'valid' },
  { name: 'valid nested', content: '<section><div><span>text</span></div></section>', expect: 'valid' },
  { name: 'generics List<String>', content: 'List<String> map<int, double> values;', expect: 'valid' },
  { name: 'math comparison', content: 'if (a < b && c > d) return true;', expect: 'valid' },
  { name: 'code fence with tags', content: '```js\nuse <map> here\n```', expect: 'valid' },
  { name: 'inline code with tag', content: 'Use `<use_mcp_tool>` to call tools.', expect: 'valid' },
  { name: 'unclosed tag', content: '<div><p>hello</p>', expect: 'invalid' },
  { name: 'mismatched closing', content: '<div><p>hello</span></p></div>', expect: 'invalid' },
  { name: 'self-closing void', content: '<div><br><img src="x"><p>text</p></div>', expect: 'valid' },
  { name: 'markdown bold with em', content: '**bold** and <em>italic</em>', expect: 'valid' },
  { name: 'html comment', content: '<!-- comment --><div>text</div>', expect: 'valid' },
  { name: 'cdata section', content: '<div>text</div><![CDATA[ <not a tag> ]]>', expect: 'valid' },
  { name: 'numeric comparison', content: '5 < 10 is true and 20 > 15 is also true', expect: 'valid' },
  { name: 'tool-use-like format', content: '<use_mcp_tool>\n<param>value</param>\n</use_mcp_tool>', expect: 'valid' },
  { name: 'processing instruction', content: '<?xml version="1.0"?><root>text</root>', expect: 'valid' },
  { name: 'tilde code fence', content: '~~~\n<not a tag>\n~~~', expect: 'valid' },
  { name: 'double backtick inline', content: '`` `<div>` ``', expect: 'valid' },
  { name: 'markdown link with angle', content: 'See [link](https://example.com/path) and <https://example.com>', expect: 'valid' },
  { name: 'html entities', content: '<div>a < b > c</div>', expect: 'valid' },
  { name: 'deeply nested valid', content: '<a><b><c><d><e>text</e></d></c></b></a>', expect: 'valid' },
  { name: 'wrong closing order', content: '<a><b>text</a></b>', expect: 'invalid' },
  { name: 'no tags at all', content: 'Just plain text with no markup at all.', expect: 'valid' },
  { name: 'only opening angle', content: 'value < 5', expect: 'valid' },
  { name: 'arrow operator', content: 'list.stream().map(x -> x + 1).collect();', expect: 'valid' },
  { name: 'generic method', content: 'Collections.<String>emptyList();', expect: 'valid' },
  { name: 'unclosed after matched', content: '<div>text</div><p>unclosed', expect: 'invalid' },
  { name: 'only angle words', content: 'just some < and > chars', expect: 'valid' },
  { name: 'two pairs + unclosed', content: '<a>x</a><b>y</b><c>z', expect: 'invalid' },
  { name: 'real truncation', content: '<div><p>hello</p><span>world', expect: 'invalid' },
  { name: 'nested outer unclosed', content: '<outer><inner>text</inner>', expect: 'invalid' },
  { name: 'self-closing slash', content: '<div><img src="x" /><p>text</p></div>', expect: 'valid' },
  { name: 'attr with angle bracket', content: '<div data-x="a > b">text</div>', expect: 'valid' },
  { name: 'multi-line tag', content: '<div\n  class="x">\n<p>text</p>\n</div>', expect: 'valid' },
  { name: 'void without closing', content: '<div><br><hr><p>text</p></div>', expect: 'valid' },
  { name: 'stray closing tag', content: '<div>text</div></span>', expect: 'invalid' },
];

let pass = 0;
let fail = 0;

for (const t of tests) {
  const v = validateContent(t.content);
  const isValid = v.valid;
  const expectedValid = t.expect === 'valid';
  if (isValid === expectedValid) {
    pass++;
    console.log(`PASS: ${t.name}`);
  } else {
    fail++;
    console.log(`FAIL: ${t.name} => expected ${t.expect}, got ${isValid ? 'valid' : 'invalid (' + formatValidationIssue(v) + ')'}`);
  }
}

// Test O(n) with large content
const large = '<div>'.repeat(1) + 'text'.repeat(100000) + '</div>';
const start = Date.now();
validateContent(large);
const elapsed = Date.now() - start;
console.log(`\nLarge content (${large.length} chars) validated in ${elapsed}ms`);

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
