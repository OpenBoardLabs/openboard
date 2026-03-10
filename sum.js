function sumArray(arr) {
  return arr.reduce((acc, curr) => acc + curr, 0);
}

const exampleArray = [1, 2, 3, 4, 5];
console.log("Sum of", exampleArray, "is:", sumArray(exampleArray));

module.exports = sumArray;
