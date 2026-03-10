// Hi! This is my code to sum up an array.
// Please let me know if I need to change anything! :)

function sumMyArray(arr) {
    var total = 0;
    
    // looping through all the numbers in the array
    for (var i = 0; i < arr.length; i = i + 1) {
        total = total + arr[i]; // adding the current number to the total
    }
    
    return total;
}

// test it out to make sure it works!
var myNumbers = [1, 2, 3, 4, 5];
var theSum = sumMyArray(myNumbers);

console.log("The sum is: " + theSum); // should be 15, I checked with my calculator
