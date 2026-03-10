// Hi!!! This is my first function to sum an array of numbers!
// I really hope it works and doesn't crash the server haha

function sumTheArray(myNumbers) {
  var theSum = 0; // We have to start at zero!
  
  // Looping through every single number in the array
  for(var i = 0; i < myNumbers.length; i = i + 1) {
    // Add the current number to our total sum
    theSum = theSum + myNumbers[i];
    // console.log("Current sum is: " + theSum); // uncomment for debugging!!
  }
  
  // Return the final answer
  return theSum;
}

// Let's test it out just to be safe
var testArray = [1, 2, 3, 4, 5];
var result = sumTheArray(testArray);

console.log("YAY! The sum of the array is: " + result); // Should print 15!
