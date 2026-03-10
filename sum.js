function sumArray(arr) {
  return arr.reduce((acc, curr) => acc + curr, 0);
}

// Example usage
const array = [1, 2, 3, 4, 5];
console.log(`The sum of [${array}] is:`, sumArray(array));

module.exports = sumArray;
