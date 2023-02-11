


function generate(n) {
    let i = 0,
        result = [];
    while (i < n) {
        result.push(createWord(3));
        i += 1;
    }
    return result.join("-");
}


function createWord(length) {
    var result           = '';
    var characters       = 'abcdefghijklmnopqrstuvwxyz';
    var charactersLength = characters.length;
    for ( var i = 0; i < length; i++ ) {
       result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
 }

module.exports = generate;