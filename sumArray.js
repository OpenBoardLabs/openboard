// Hi, I made this function to sum an array!
// I hope it works well.
function sumMyArray(arr) {
    let total = 0; // we start at zero

    // loop through every item in the array
    for (let i = 0; i < arr.length; i++) {
        // console.log("adding: " + arr[i]); // uncomment this if you need to debug!
        total = total + arr[i];
    }

    return total; // return the final number
}

// test it out
let numbers = [1, 2, 3, 4, 5];
let result = sumMyArray(numbers);
console.log("The total sum is: " + result);
