function sumArray(arr) {
  return arr.reduce((acc, current) => acc + current, 0);
}

const numbers = [1, 2, 3, 4, 5];
console.log('The sum of', numbers, 'is:', sumArray(numbers));

module.exports = sumArray;