'use strict';

/**
 * arabic_transliterate.js
 * Converts Arabic text to English transliteration.
 * Optimized for Gulf region names and addresses (Kuwait, UAE, Saudi Arabia).
 */

// Common Arabic words/phrases → English equivalents (for addresses)
const WORD_MAP = {
  // Directions & address words
  'شارع': 'Street',
  'ش': 'St',
  'قطعة': 'Block',
  'قطعه': 'Block',
  'منزل': 'House',
  'بيت': 'House',
  'مبنى': 'Building',
  'بناية': 'Building',
  'طابق': 'Floor',
  'دور': 'Floor',
  'شقة': 'Apt',
  'مدينة': 'City',
  'حي': 'District',
  'منطقة': 'Area',
  'جادة': 'Avenue',
  'زقاق': 'Lane',
  'ملحق': 'Annex',
  'قرب': 'Near',
  'بجانب': 'Next to',
  'أمام': 'In front of',
  'خلف': 'Behind',

  // Kuwait areas
  'الكويت': 'Kuwait',
  'الكويت العاصمة': 'Kuwait City',
  'مدينة الكويت': 'Kuwait City',
  'السالمية': 'Salmiya',
  'حولي': 'Hawalli',
  'الفروانية': 'Farwaniya',
  'الجهراء': 'Jahra',
  'الأحمدي': 'Ahmadi',
  'مبارك الكبير': 'Mubarak Al-Kabeer',
  'العاصمة': 'Kuwait City',
  'الروضة': 'Rumaithiya',
  'الرميثية': 'Rumaithiya',
  'البيان': 'Bayan',
  'السلام': 'Salam',
  'الفحيحيل': 'Fahaheel',
  'الرقة': 'Ruqqa',
  'الجابرية': 'Jabriya',
  'النزهة': 'Nuzha',
  'الشامية': 'Shamiya',
  'الخالدية': 'Khalidiya',
  'الأندلس': 'Andalus',
  'الصليبيخات': 'Sulaibikhaat',
  'الشويخ': 'Shuwaikh',
  'الصباحية': 'Sabahiya',
  'الفنطاس': 'Fintas',
  'المنقف': 'Mangaf',
  'أبو حليفة': 'Abu Halifa',
  'الرقعي': 'Ruqai',
  'العارضية': 'Ardiya',
  'الصليبية': 'Sulaibiya',
  'القرين': 'Qurain',
  'المهبولة': 'Mahboula',
  'ضاحية عبدالله السالم': 'Abdullah Al-Salem',
  'عبدالله السالم': 'Abdullah Al-Salem',
  'الكيفان': 'Kaifan',
  'الدسمة': 'Dasman',
  'الشرق': 'Sharq',
  'قبلة': 'Qibla',
  'ميدان حولي': 'Hawalli',
  'الزهراء': 'Zahra',
  'بنيد القار': 'Bnaid Al-Qar',
  'الدعية': 'Daiya',
  'المنصورية': 'Mansouriya',
  'الصوابر': 'Sawaber',
  'الصفاة': 'Safat',
  'سلوى': 'Salwa',
  'الرابية': 'Rabiya',
  'الوطية': 'Watiya',
  'العدان': 'Addan',
  'المسيلة': 'Messila',
  'الأمير': 'Ameer',

  // UAE
  'دبي': 'Dubai',
  'أبوظبي': 'Abu Dhabi',
  'أبو ظبي': 'Abu Dhabi',
  'الشارقة': 'Sharjah',
  'عجمان': 'Ajman',
  'رأس الخيمة': 'Ras Al Khaimah',
  'الفجيرة': 'Fujairah',
  'أم القيوين': 'Umm Al Quwain',

  // Saudi Arabia
  'الرياض': 'Riyadh',
  'جدة': 'Jeddah',
  'مكة': 'Mecca',
  'المدينة': 'Medina',
  'الدمام': 'Dammam',
  'الخبر': 'Khobar',
  'الطائف': 'Taif',

  // Common Gulf first names (male)
  'محمد': 'Mohammed', 'مشاري': 'Mishari', 'فهد': 'Fahad',
  'عبدالله': 'Abdullah', 'عبدالرحمن': 'Abdulrahman', 'عبدالعزيز': 'Abdulaziz',
  'عبدالكريم': 'Abdulkarim', 'عبدالرحيم': 'Abdulrahim', 'عبدالوهاب': 'Abdulwahab',
  'خالد': 'Khaled', 'أحمد': 'Ahmed', 'علي': 'Ali',
  'سعد': 'Saad', 'سلطان': 'Sultan', 'ناصر': 'Nasser',
  'يوسف': 'Yousef', 'عمر': 'Omar', 'حمد': 'Hamad',
  'جاسم': 'Jassim', 'بدر': 'Badr', 'وليد': 'Waleed',
  'طارق': 'Tariq', 'رياض': 'Riyad', 'منصور': 'Mansour',
  'راشد': 'Rashed', 'سالم': 'Salem', 'حسن': 'Hassan',
  'حسين': 'Hussein', 'كريم': 'Kareem', 'إبراهيم': 'Ibrahim',
  'إسماعيل': 'Ismail', 'عيسى': 'Issa', 'موسى': 'Musa',
  'عادل': 'Adel', 'نواف': 'Nawaf', 'مساعد': 'Musaed',
  'صالح': 'Saleh', 'حمزة': 'Hamza', 'زياد': 'Ziad',
  'فيصل': 'Faisal', 'تركي': 'Turki', 'سعود': 'Saud',
  'نايف': 'Nayef', 'متعب': 'Muteb', 'بندر': 'Bandar',
  'ماجد': 'Majed', 'خليل': 'Khalil', 'جمال': 'Jamal',
  'كامل': 'Kamel', 'نبيل': 'Nabil', 'وائل': 'Wael',
  'هاني': 'Hani', 'سامي': 'Sami', 'مازن': 'Mazen',
  'أسامة': 'Osama', 'رامي': 'Rami', 'باسم': 'Basem',
  'شريف': 'Sherif', 'مصطفى': 'Mustafa', 'مروان': 'Marwan',
  'عمار': 'Ammar', 'بلال': 'Bilal', 'أنس': 'Anas',
  'زكريا': 'Zakaria', 'عثمان': 'Othman', 'حمود': 'Hamoud',
  'صقر': 'Saqr', 'غانم': 'Ghanem', 'مبارك': 'Mubarak',
  // Common Gulf first names (female)
  'فاطمة': 'Fatima', 'نورة': 'Noura', 'مريم': 'Mariam',
  'سارة': 'Sara', 'هند': 'Hind', 'لطيفة': 'Latifa',
  'منيرة': 'Munira', 'شيخة': 'Sheikha', 'موزة': 'Moza',
  'ريم': 'Reem', 'دانة': 'Dana', 'هيا': 'Haya',
  'نجلاء': 'Najla', 'أميرة': 'Amira', 'زينب': 'Zainab',
  'خديجة': 'Khadija', 'عائشة': 'Aisha', 'رقية': 'Ruqaya',
  'سلمى': 'Salma', 'رنا': 'Rana', 'لينا': 'Lina',
  'نادية': 'Nadia', 'رولا': 'Rola', 'ميساء': 'Maisa',
  'شهد': 'Shahad', 'غدير': 'Ghadeer', 'رهف': 'Rahaf',
  'جواهر': 'Jawahir', 'بدرية': 'Badriya', 'حصة': 'Hessa',
  // Common family name prefixes
  'آل': 'Al', 'بن': 'Bin', 'ابن': 'Ibn',
  'بنت': 'Bint', 'أبو': 'Abu', 'ام': 'Um',
  // Common name prefixes/titles
  'الشيخ': 'Sheikh',
  'شيخة': 'Sheikha',
  'سيد': 'Sayed',
  'سيدة': 'Sayeda',
  'دكتور': 'Dr',
  'دكتورة': 'Dr',
  'مهندس': 'Eng',
  'أستاذ': 'Prof',
};

// Arabic letter → English phonetic mapping
const LETTER_MAP = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'aa',
  'ب': 'b', 'ت': 't', 'ث': 'th',
  'ج': 'j', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'dh', 'ر': 'r',
  'ز': 'z', 'س': 's', 'ش': 'sh',
  'ص': 's', 'ض': 'd', 'ط': 't',
  'ظ': 'dh', 'ع': "'", 'غ': 'gh',
  'ف': 'f', 'ق': 'q', 'ك': 'k',
  'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y',
  'ى': 'a', 'ة': 'a', 'ء': "'",
  'ئ': 'y', 'ؤ': 'w', 'لا': 'la',
  // Diacritics (ignore)
  'َ': 'a', 'ُ': 'u', 'ِ': 'i',
  'ً': 'an', 'ٌ': 'un', 'ٍ': 'in',
  'ّ': '', 'ْ': '',
  // Al- prefix
  'ال': 'Al-',
};

// Capitalize first letter of each word
function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text || '');
}

function transliterateWord(word) {
  // Check word map first (exact match)
  if (WORD_MAP[word]) return WORD_MAP[word];

  // Handle "ال" (al-) prefix
  let result = '';
  let i = 0;
  const chars = [...word]; // handle multi-char unicode properly

  // Check for ال prefix
  if (chars[0] === 'ا' && chars[1] === 'ل') {
    result = 'Al-';
    i = 2;
    // Skip the sun letter doubling (shadda after ال)
    if (chars[i] === 'ّ') i++;
  }

  while (i < chars.length) {
    const twoChar = chars[i] + (chars[i+1] || '');
    if (LETTER_MAP[twoChar]) {
      result += LETTER_MAP[twoChar];
      i += 2;
    } else if (LETTER_MAP[chars[i]]) {
      result += LETTER_MAP[chars[i]];
      i++;
    } else if (/\d/.test(chars[i])) {
      result += chars[i];
      i++;
    } else {
      // Keep non-Arabic characters as-is (numbers, spaces, punctuation)
      result += chars[i];
      i++;
    }
  }

  return result;
}

function transliterate(text) {
  if (!text) return '';
  if (!hasArabic(text)) return text;

  // Split into tokens (words + separators)
  const tokens = text.split(/(\s+|[,،.\/\-]+)/);
  const result = tokens.map(token => {
    if (!token.trim() || !hasArabic(token)) return token;

    // Check full word in word map
    const trimmed = token.trim();
    if (WORD_MAP[trimmed]) return WORD_MAP[trimmed];

    // Transliterate letter by letter
    const trans = transliterateWord(trimmed);
    return titleCase(trans);
  });

  return result.join('').trim();
}

module.exports = { transliterate, hasArabic };
