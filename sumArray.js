// hello! this is my first javascript file to sum an array
// i learned this in my bootcamp!
function sum(myArray) {
    var total = 0; // initialize a variable to hold the sum
    
    // loop through every number in the array
    for (var i = 0; i < myArray.length; i++) {
        total = total + myArray[i]; // add current number to the total
    }
    
    return total; // return the final answer!
}

var testArray = [1, 2, 3];
console.log("the sum is: " + sum(testArray));
