function randomtext() {
    var randomtxt = [
        'deeply\, unfathomably\, senselessly\, terribly',
	'everything on earth with you',
	'in case you ever foolishly forget',
        'deeply\, unfathomably\, senselessly\, terribly',
        'desperate attempt to sound like someone new',
        'obscure popular culture',
        'untenable but inalterable',
        'it\'s got lots to do with magnets',
	'on its last legs',
	'better days to come',
	'please clap',
	'a dead dream',
	'it doesn\'t even matter',
        'same as it ever was',
	'powered by quiet noise',
	'product of lost imagination'
	];
    return randomtxt[Math.floor((Math.random() * 15.99))];
}

document.getElementById("words").innerHTML = randomtext();
