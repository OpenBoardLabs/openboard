function sumArray(arr) {
  if (!Array.isArray(arr)) {
    throw new TypeError('Argument must be an array');
  }
  return arr.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
}

// Example usage
const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
console.log(`The sum of [${numbers}] is ${sumArray(numbers)}`);

module.exports = sumArray;
