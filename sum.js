function sumArray(arr) {
  if (!Array.isArray(arr)) {
    throw new TypeError("Argument must be an array");
  }
  return arr.reduce((acc, curr) => acc + curr, 0);
}

const exampleArray = [1, 2, 3, 4, 5];
console.log(`The sum of [${exampleArray}] is: ${sumArray(exampleArray)}`);

module.exports = sumArray;
