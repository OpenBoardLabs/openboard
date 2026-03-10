// Hey guys! This is my first javascript file to sum an array!
// I hope it works well. Please let me know if I need to change anything!

function sumMyArray(arr) {
  var total = 0; // starting at zero
  
  // loop through all the numbers one by one
  for (var i = 0; i < arr.length; i++) {
    total = total + arr[i]; // add current number to total
  }
  
  return total;
}

// let's test it to make sure it works!
// The task says sum 12, so I will make an array that equals 12
var myAwesomeNumbers = [2, 4, 6]; 
var theSum = sumMyArray(myAwesomeNumbers);

console.log("The sum of the array is: " + theSum); // hopefully it is 12!
