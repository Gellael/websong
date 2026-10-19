use crate::Card;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ComboKind {
    Single,
    Pair,
    Triple,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Combo {
    pub kind: ComboKind,
    pub cards: Vec<Card>, // selalu terurut naik
}

impl Combo {
    /// Mengubah kumpulan kartu menjadi kombinasi, atau None kalau tidak valid.
    pub fn from_cards(cards: &[Card]) -> Option<Combo> {
        let mut cards = cards.to_vec();
        cards.sort();

        let kind = match cards.len() {
            1 => ComboKind::Single,
            2 => ComboKind::Pair,
            3 => ComboKind::Triple,
            _ => return None,
        };

        // semua harus senilai
        if !cards.iter().all(|c| c.rank == cards[0].rank) {
            return None;
        }
        // tidak boleh ada kartu kembar
        if cards.windows(2).any(|w| w[0] == w[1]) {
            return None;
        }
        Some(Combo { kind, cards })
    }

    /// Kartu tertinggi (nilai dulu, lalu jenis) dipakai sebagai pembanding.
    pub fn top(&self) -> Card {
        *self.cards.last().unwrap()
    }

    pub fn beats(&self, other: &Combo) -> bool {
        self.kind == other.kind && self.top() > other.top()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Suit::*;

    fn c(rank: u8, suit: crate::Suit) -> Card {
        Card { rank, suit }
    }

    #[test]
    fn builds_valid_combos() {
        assert_eq!(Combo::from_cards(&[c(5, Hearts)]).unwrap().kind, ComboKind::Single);
        assert_eq!(
            Combo::from_cards(&[c(5, Hearts), c(5, Clubs)]).unwrap().kind,
            ComboKind::Pair
        );
        assert_eq!(
            Combo::from_cards(&[c(5, Hearts), c(5, Clubs), c(5, Spades)]).unwrap().kind,
            ComboKind::Triple
        );
    }

    #[test]
    fn rejects_invalid_combos() {
        assert!(Combo::from_cards(&[]).is_none());
        assert!(Combo::from_cards(&[c(5, Hearts), c(6, Hearts)]).is_none());
        assert!(Combo::from_cards(&[c(5, Hearts), c(5, Hearts)]).is_none());
    }

    #[test]
    fn suit_breaks_ties() {
        let low = Combo::from_cards(&[c(9, Diamonds)]).unwrap();
        let high = Combo::from_cards(&[c(9, Spades)]).unwrap();
        assert!(high.beats(&low));
        assert!(!low.beats(&high));
    }

    #[test]
    fn different_kind_never_beats() {
        let single = Combo::from_cards(&[c(14, Spades)]).unwrap();
        let pair = Combo::from_cards(&[c(3, Hearts), c(3, Clubs)]).unwrap();
        assert!(!single.beats(&pair));
        assert!(!pair.beats(&single));
    }
}