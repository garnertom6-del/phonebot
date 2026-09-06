/** NPI uses the Luhn check digit with the 80840 prefix. This checks format, not authorization. */
export function validNpi(value: string): boolean {
  if (!/^[12]\d{9}$/.test(value)) return false;
  const digits = `80840${value}`;
  let sum = 0;
  for (let i = digits.length - 1, position = 0; i >= 0; i--, position++) {
    let digit = Number(digits[i]);
    if (position % 2) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
