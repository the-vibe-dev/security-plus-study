// Text-only lexer for finite simulated fixtures. Never invokes a shell.
export function commandTokens(value, shell = 'bash') {
  if (typeof value !== 'string' || value.length > 200) return null;
  const windows = ['powershell', 'cmd'].includes(shell);
  const tokens = []; let word = ''; let quote = ''; let started = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && !windows && quote !== "'") {
      if (++index >= value.length) return null;
      word += value[index]; started = true;
    } else if (quote) {
      if (char === quote) quote = ''; else word += char;
    } else if (char === '"' || char === "'") { quote = char; started = true; }
    else if (/\s/.test(char)) { if (started) { tokens.push(word); word = ''; started = false; } }
    else { word += char; started = true; }
  }
  if (quote) return null;
  if (started) tokens.push(word);
  // Command names and named parameters in these Windows fixtures are case insensitive.
  return tokens.map((token, index) => windows && (index === 0 || /^-[a-z]/i.test(token)) ? token.toLowerCase() : token);
}
export function matchesCommand(command, accepted, shell = 'bash') {
  const actual = commandTokens(command, shell);
  return actual?.length > 0 && accepted.some((form) => JSON.stringify(actual) === JSON.stringify(commandTokens(form, shell)));
}
