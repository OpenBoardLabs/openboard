// this is a function to sum an array
function sumArray(arr) {
  var total = 0; // start at zero
  for(var i = 0; i < arr.length; i++) {
    // add each number to the total
    total = total + arr[i];
  }
  return total; // give back the final number
}

var myArray = [1, 2, 3, 4, 5]; // my numbers
var result = sumArray(myArray);
console.log("the sum is: " + result); // print it so i can see
