// Hey! This is my first function to sum up an array of numbers!
// I hope it works correctly :)

function sumArray(arr) {
  let total = 0; // we have to start at 0
  
  // loop through all the items in the array one by one
  for (let i = 0; i < arr.length; i++) {
    total = total + arr[i]; // add the current number to our total
  }
  
  return total; // give back the final answer
}

// export it so we can use it in other places
module.exports = sumArray;
