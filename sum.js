// This function takes an array and adds all the numbers together
function sum(arr) {
  // we start with 0 because we haven't added anything yet
  let total = 0; 
  
  // going through each number in the array one by one
  for (let i = 0; i < arr.length; i++) {
    // add the current number to our total
    total = total + arr[i]; 
  }
  
  // return the final answer
  return total;
}

// testing my code to make sure it works!
let myNumbers = [1, 2, 3, 4, 5];
let result = sum(myNumbers);
console.log("The sum of the array is: " + result); // hopefully it prints 15!
