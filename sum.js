// this is a function to sum an array of numbers
function sumArray(arr) {
  var total = 0; // set total to 0
  for (var i = 0; i < arr.length; i = i + 1) { // loop through the array
    total = total + arr[i]; // add each number to total
  }
  return total; // return the final total
}

// test it out
var myNumbers = [1, 2, 3, 4, 5];
var result = sumArray(myNumbers);
console.log("The sum is: " + result); // should print 15
