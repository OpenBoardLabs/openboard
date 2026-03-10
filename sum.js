function sumArray(arr) {
  if (!Array.isArray(arr)) {
    throw new TypeError('Argument must be an array');
  }
  return arr.reduce((acc, current) => acc + current, 0);
}

// Example usage
const numbers = [1, 2, 3, 4, 5];
console.log(`The sum of [${numbers}] is:`, sumArray(numbers));

module.exports = sumArray;
