// hi, this is my script to sum an array of numbers
// it takes an array and returns the total sum
function sumArray(arr) {
  var total = 0; // start with zero
  
  // loop over every item in the array
  for (var i = 0; i < arr.length; i++) {
    // console.log("current number is " + arr[i]);
    total = total + arr[i]; // add it to total
  }
  
  return total;
}

// test it here to make sure it works
var myNumbers = [1, 2, 3, 4, 5];
var theSum = sumArray(myNumbers);

console.log("the total is: " + theSum); // should be 15
