import type { Lang } from '../lib/core'

export type SectionId = 'aptitude' | 'technical' | 'coding'

export interface McqQuestion {
  id: string
  section: SectionId
  type: 'mcq'
  text: Record<Lang, { prompt: string; options: string[] }>
  key: number
  reference?: 'binary-tree'
}

export interface TestCase { input: string; output: string }

export type CodeLang = 'js' | 'py'

export const CODE_LANGS: Record<CodeLang, string> = { js: 'JavaScript (Node 20)', py: 'Python 3.12' }

// What the candidate edits (`code`) and the locked driver that reads stdin, calls it and prints.
export interface CodeTemplate { code: string; driver: string }

export interface CodingQuestion {
  id: string
  section: 'coding'
  type: 'coding'
  text: Record<Lang, { title: string; statement: string; input: string; output: string }>
  samples: TestCase[]
  hidden: TestCase[]
  templates: Record<CodeLang, CodeTemplate>
}

export type Question = McqQuestion | CodingQuestion

export const PAPER = { code: 'Paper C', version: '2026.10-C', title: 'ExamShield Graduate Assessment' }

export const SECTIONS: Array<{ id: SectionId; name: Record<Lang, string>; marks: string }> = [
  { id: 'aptitude', name: { en: 'Aptitude & Reasoning', hi: 'योग्यता एवं तर्क' }, marks: '+2 / 0' },
  { id: 'technical', name: { en: 'Technical & DSA', hi: 'तकनीकी एवं डीएसए' }, marks: '+2 / 0' },
  { id: 'coding', name: { en: 'Coding', hi: 'कोडिंग' }, marks: '+10 per problem' },
]

export const QUESTIONS: Question[] = [
  {
    id: 'A1', section: 'aptitude', type: 'mcq', key: 2,
    text: {
      en: { prompt: 'A train 240 m long passes a pole in 12 seconds. How long will it take to cross a platform 360 m long?', options: ['24 seconds', '36 seconds', '30 seconds', '18 seconds'] },
      hi: { prompt: '240 मीटर लंबी एक ट्रेन एक खंभे को 12 सेकंड में पार करती है। 360 मीटर लंबे प्लेटफॉर्म को पार करने में कितना समय लगेगा?', options: ['24 सेकंड', '36 सेकंड', '30 सेकंड', '18 सेकंड'] },
    },
  },
  {
    id: 'A2', section: 'aptitude', type: 'mcq', key: 1,
    text: {
      en: { prompt: 'Find the next number in the series: 3, 8, 15, 24, 35, ?', options: ['46', '48', '50', '44'] },
      hi: { prompt: 'श्रृंखला की अगली संख्या ज्ञात कीजिए: 3, 8, 15, 24, 35, ?', options: ['46', '48', '50', '44'] },
    },
  },
  {
    id: 'A3', section: 'aptitude', type: 'mcq', key: 3,
    text: {
      en: { prompt: '12 workers can finish a job in 15 days. How many days will 20 workers take to finish the same job?', options: ['8', '10', '12', '9'] },
      hi: { prompt: '12 श्रमिक एक काम 15 दिनों में पूरा करते हैं। वही काम 20 श्रमिक कितने दिनों में पूरा करेंगे?', options: ['8', '10', '12', '9'] },
    },
  },
  {
    id: 'A4', section: 'aptitude', type: 'mcq', key: 0,
    text: {
      en: { prompt: 'An article bought for ₹800 is sold at a 25% profit. What is the selling price?', options: ['₹1000', '₹950', '₹1025', '₹1100'] },
      hi: { prompt: '₹800 में खरीदी गई एक वस्तु 25% लाभ पर बेची जाती है। विक्रय मूल्य क्या है?', options: ['₹1000', '₹950', '₹1025', '₹1100'] },
    },
  },
  {
    id: 'A5', section: 'aptitude', type: 'mcq', key: 2,
    text: {
      en: { prompt: "Pointing to a man, Riya says, \"He is the son of my grandfather's only son.\" How is the man related to Riya?", options: ['Cousin', 'Uncle', 'Brother', 'Father'] },
      hi: { prompt: 'एक व्यक्ति की ओर इशारा करते हुए रिया कहती है, "वह मेरे दादा के इकलौते पुत्र का पुत्र है।" वह व्यक्ति रिया का क्या लगता है?', options: ['चचेरा भाई', 'चाचा', 'भाई', 'पिता'] },
    },
  },
  {
    id: 'A6', section: 'aptitude', type: 'mcq', key: 3,
    text: {
      en: { prompt: 'Statements: All pens are books. Some books are bags. Conclusions: I. Some pens are bags. II. Some bags are books.', options: ['Only I follows', 'Both I and II follow', 'Neither I nor II follows', 'Only II follows'] },
      hi: { prompt: 'कथन: सभी पेन किताबें हैं। कुछ किताबें बैग हैं। निष्कर्ष: I. कुछ पेन बैग हैं। II. कुछ बैग किताबें हैं।', options: ['केवल I अनुसरण करता है', 'I और II दोनों अनुसरण करते हैं', 'न I न II अनुसरण करता है', 'केवल II अनुसरण करता है'] },
    },
  },
  {
    id: 'A7', section: 'aptitude', type: 'mcq', key: 0,
    text: {
      en: { prompt: 'A price is increased by 20% and then decreased by 20%. What is the net change?', options: ['4% decrease', 'No change', '4% increase', '2% decrease'] },
      hi: { prompt: 'एक मूल्य को 20% बढ़ाया जाता है और फिर 20% घटाया जाता है। कुल परिवर्तन क्या है?', options: ['4% कमी', 'कोई परिवर्तन नहीं', '4% वृद्धि', '2% कमी'] },
    },
  },
  {
    id: 'A8', section: 'aptitude', type: 'mcq', key: 2,
    text: {
      en: { prompt: "What is Ravi's age? I. Ravi's and Sonu's ages are in the ratio 3 : 4. II. Sonu is 8 years older than Ravi.", options: ['I alone is sufficient', 'II alone is sufficient', 'Both I and II together are sufficient', 'Both together are not sufficient'] },
      hi: { prompt: 'रवि की आयु क्या है? I. रवि और सोनू की आयु का अनुपात 3 : 4 है। II. सोनू, रवि से 8 वर्ष बड़ा है।', options: ['केवल I पर्याप्त है', 'केवल II पर्याप्त है', 'I और II दोनों मिलकर पर्याप्त हैं', 'दोनों मिलकर भी पर्याप्त नहीं हैं'] },
    },
  },
  {
    id: 'A9', section: 'aptitude', type: 'mcq', key: 1,
    text: {
      en: { prompt: 'Two fair dice are rolled. What is the probability that the sum is 7?', options: ['1/12', '1/6', '5/36', '7/36'] },
      hi: { prompt: 'दो निष्पक्ष पासे फेंके जाते हैं। योग 7 आने की प्रायिकता क्या है?', options: ['1/12', '1/6', '5/36', '7/36'] },
    },
  },
  {
    id: 'A10', section: 'aptitude', type: 'mcq', key: 3,
    text: {
      en: { prompt: 'If CAT is coded as DBU, how is DOG coded?', options: ['EPG', 'CNF', 'EOH', 'EPH'] },
      hi: { prompt: 'यदि CAT को DBU लिखा जाता है, तो DOG को कैसे लिखा जाएगा?', options: ['EPG', 'CNF', 'EOH', 'EPH'] },
    },
  },
  {
    id: 'A11', section: 'aptitude', type: 'mcq', key: 0,
    text: {
      en: { prompt: 'What is the compound interest on ₹10,000 at 10% per annum for 2 years, compounded annually?', options: ['₹2100', '₹2000', '₹2200', '₹2010'] },
      hi: { prompt: '₹10,000 पर 10% वार्षिक दर से 2 वर्ष का चक्रवृद्धि ब्याज (वार्षिक संयोजित) कितना होगा?', options: ['₹2100', '₹2000', '₹2200', '₹2010'] },
    },
  },
  {
    id: 'A12', section: 'aptitude', type: 'mcq', key: 2,
    text: {
      en: { prompt: 'Aman walks 6 km north, turns right and walks 8 km. How far is he from his starting point?', options: ['14 km', '12 km', '10 km', '8 km'] },
      hi: { prompt: 'अमन 6 किमी उत्तर की ओर चलता है, फिर दाएँ मुड़कर 8 किमी चलता है। वह अपने आरंभिक बिंदु से कितनी दूर है?', options: ['14 किमी', '12 किमी', '10 किमी', '8 किमी'] },
    },
  },
  {
    id: 'T1', section: 'technical', type: 'mcq', key: 0, reference: 'binary-tree',
    text: {
      en: { prompt: 'Using the binary-tree reference shown alongside, which sequence is the inorder traversal of the tree?', options: ['2, 4, 5, 7, 8', '5, 2, 4, 8, 7', '2, 5, 4, 7, 8', '4, 2, 5, 8, 7'] },
      hi: { prompt: 'साथ में दिखाए गए बाइनरी ट्री के संदर्भ से, ट्री का इनऑर्डर ट्रैवर्सल कौन-सा है?', options: ['2, 4, 5, 7, 8', '5, 2, 4, 8, 7', '2, 5, 4, 7, 8', '4, 2, 5, 8, 7'] },
    },
  },
  {
    id: 'T2', section: 'technical', type: 'mcq', key: 1,
    text: {
      en: { prompt: 'What is the worst-case time complexity of binary search on a sorted array of n elements?', options: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'] },
      hi: { prompt: 'n तत्वों वाले क्रमबद्ध ऐरे पर बाइनरी सर्च की सबसे खराब स्थिति में समय जटिलता क्या है?', options: ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'] },
    },
  },
  {
    id: 'T3', section: 'technical', type: 'mcq', key: 1,
    text: {
      en: { prompt: 'Which data structure is used to implement Breadth-First Search (BFS) on a graph?', options: ['Stack', 'Queue', 'Heap', 'Hash table'] },
      hi: { prompt: 'ग्राफ पर ब्रेड्थ-फर्स्ट सर्च (BFS) लागू करने के लिए कौन-सी डेटा संरचना उपयोग होती है?', options: ['स्टैक', 'क्यू', 'हीप', 'हैश टेबल'] },
    },
  },
  {
    id: 'T4', section: 'technical', type: 'mcq', key: 2,
    text: {
      en: { prompt: 'In SQL, which clause filters groups produced by GROUP BY?', options: ['WHERE', 'ORDER BY', 'HAVING', 'LIMIT'] },
      hi: { prompt: 'SQL में GROUP BY द्वारा बने समूहों को कौन-सा क्लॉज़ फ़िल्टर करता है?', options: ['WHERE', 'ORDER BY', 'HAVING', 'LIMIT'] },
    },
  },
  {
    id: 'T5', section: 'technical', type: 'mcq', key: 1,
    text: {
      en: { prompt: 'In Java, runtime polymorphism is achieved through:', options: ['Method overloading', 'Method overriding', 'Constructors', 'Static methods'] },
      hi: { prompt: 'Java में रनटाइम पॉलीमॉर्फिज़्म किसके द्वारा प्राप्त होता है?', options: ['मेथड ओवरलोडिंग', 'मेथड ओवरराइडिंग', 'कंस्ट्रक्टर', 'स्टैटिक मेथड'] },
    },
  },
  {
    id: 'T6', section: 'technical', type: 'mcq', key: 2,
    text: {
      en: { prompt: 'Which of the following is NOT one of the four necessary (Coffman) conditions for deadlock?', options: ['Mutual exclusion', 'Hold and wait', 'Preemption', 'Circular wait'] },
      hi: { prompt: 'निम्न में से कौन-सी डेडलॉक की चार आवश्यक (कॉफ़मैन) शर्तों में से नहीं है?', options: ['परस्पर अपवर्जन', 'होल्ड एंड वेट', 'प्रीएम्प्शन', 'सर्कुलर वेट'] },
    },
  },
  {
    id: 'T7', section: 'technical', type: 'mcq', key: 3,
    text: {
      en: { prompt: 'A relation is in 2NF and no non-prime attribute is transitively dependent on a candidate key. The relation is in:', options: ['1NF only', 'BCNF necessarily', '4NF', '3NF'] },
      hi: { prompt: 'एक रिलेशन 2NF में है और कोई भी नॉन-प्राइम एट्रिब्यूट किसी कैंडिडेट की पर ट्रांज़िटिवली निर्भर नहीं है। यह रिलेशन किसमें है?', options: ['केवल 1NF', 'अनिवार्य रूप से BCNF', '4NF', '3NF'] },
    },
  },
  {
    id: 'T8', section: 'technical', type: 'mcq', key: 0,
    text: {
      en: { prompt: 'Which CPU scheduling algorithm can cause starvation of long processes?', options: ['Shortest Job First', 'Round Robin', 'First Come First Serve', 'None of these'] },
      hi: { prompt: 'कौन-सा CPU शेड्यूलिंग एल्गोरिदम लंबी प्रक्रियाओं की स्टार्वेशन का कारण बन सकता है?', options: ['शॉर्टेस्ट जॉब फ़र्स्ट', 'राउंड रॉबिन', 'फ़र्स्ट कम फ़र्स्ट सर्व', 'इनमें से कोई नहीं'] },
    },
  },
  {
    id: 'T9', section: 'technical', type: 'mcq', key: 2,
    text: {
      en: { prompt: 'At which layer of the OSI model does TCP operate?', options: ['Network', 'Session', 'Transport', 'Data Link'] },
      hi: { prompt: 'TCP, OSI मॉडल की किस लेयर पर काम करता है?', options: ['नेटवर्क', 'सेशन', 'ट्रांसपोर्ट', 'डेटा लिंक'] },
    },
  },
  {
    id: 'T10', section: 'technical', type: 'mcq', key: 3,
    text: {
      en: { prompt: 'What is the output of this C code?  int a[] = {1, 2, 3, 4, 5}; int *p = a + 1; printf("%d", *p + *(p + 2));', options: ['4', '5', '7', '6'] },
      hi: { prompt: 'इस C कोड का आउटपुट क्या है?  int a[] = {1, 2, 3, 4, 5}; int *p = a + 1; printf("%d", *p + *(p + 2));', options: ['4', '5', '7', '6'] },
    },
  },
  {
    id: 'T11', section: 'technical', type: 'mcq', key: 0,
    text: {
      en: { prompt: 'Which of the following sorting algorithms is stable?', options: ['Merge sort', 'Quick sort', 'Heap sort', 'Selection sort'] },
      hi: { prompt: 'निम्न में से कौन-सा सॉर्टिंग एल्गोरिदम स्थिर (stable) है?', options: ['मर्ज सॉर्ट', 'क्विक सॉर्ट', 'हीप सॉर्ट', 'सिलेक्शन सॉर्ट'] },
    },
  },
  {
    id: 'T12', section: 'technical', type: 'mcq', key: 1,
    text: {
      en: { prompt: 'Table A has 4 rows and table B has 3 rows. How many rows does A CROSS JOIN B return?', options: ['7', '12', '4', '3'] },
      hi: { prompt: 'तालिका A में 4 पंक्तियाँ और तालिका B में 3 पंक्तियाँ हैं। A CROSS JOIN B कितनी पंक्तियाँ लौटाएगा?', options: ['7', '12', '4', '3'] },
    },
  },
  {
    id: 'C1', section: 'coding', type: 'coding',
    text: {
      en: {
        title: 'Maximum Subarray Sum',
        statement: 'Given an array of n integers, print the largest sum of any non-empty contiguous subarray.',
        input: 'Line 1: integer n (1 ≤ n ≤ 10^5). Line 2: n space-separated integers.',
        output: 'A single integer — the maximum subarray sum.',
      },
      hi: {
        title: 'अधिकतम सबऐरे योग',
        statement: 'n पूर्णांकों का एक ऐरे दिया गया है। किसी भी गैर-रिक्त क्रमागत सबऐरे का सबसे बड़ा योग प्रिंट कीजिए।',
        input: 'पंक्ति 1: पूर्णांक n (1 ≤ n ≤ 10^5)। पंक्ति 2: स्पेस से अलग n पूर्णांक।',
        output: 'एक पूर्णांक — अधिकतम सबऐरे योग।',
      },
    },
    samples: [{ input: '9\n-2 1 -3 4 -1 2 1 -5 4', output: '6' }, { input: '3\n-3 -1 -2', output: '-1' }],
    hidden: [{ input: '1\n7', output: '7' }, { input: '6\n2 -1 2 3 -9 4', output: '6' }, { input: '5\n1 2 3 4 5', output: '15' }],
    templates: {
      js: {
        code: `/**
 * Returns the largest sum of a non-empty contiguous subarray.
 * @param {number[]} nums
 * @return {number}
 */
function maxSubarraySum(nums) {
  // Write your code here

}
`,
        driver: `const n = Number(readLine());
const nums = readLine().trim().split(/\\s+/).slice(0, n).map(Number);
console.log(maxSubarraySum(nums));`,
      },
      py: {
        code: `from typing import List


class Solution:
    def maxSubarraySum(self, nums: List[int]) -> int:
        # Write your code here
        pass
`,
        driver: `import sys

data = sys.stdin.read().split()
n = int(data[0])
nums = list(map(int, data[1:1 + n]))
print(Solution().maxSubarraySum(nums))`,
      },
    },
  },
  {
    id: 'C2', section: 'coding', type: 'coding',
    text: {
      en: {
        title: 'Run-Length Compression',
        statement: 'Compress a string of lowercase letters by replacing every run of the same character with the character followed by the run length.',
        input: 'A single line containing the string s (1 ≤ |s| ≤ 10^5).',
        output: 'The compressed string, e.g. aaabccdddd → a3b1c2d4.',
      },
      hi: {
        title: 'रन-लेंथ संपीड़न',
        statement: 'छोटे अक्षरों की स्ट्रिंग में एक ही अक्षर के हर लगातार समूह को उस अक्षर और उसकी गिनती से बदलकर संपीड़ित कीजिए।',
        input: 'एक पंक्ति जिसमें स्ट्रिंग s (1 ≤ |s| ≤ 10^5) है।',
        output: 'संपीड़ित स्ट्रिंग, जैसे aaabccdddd → a3b1c2d4।',
      },
    },
    samples: [{ input: 'aaabccdddd', output: 'a3b1c2d4' }, { input: 'z', output: 'z1' }],
    hidden: [{ input: 'abc', output: 'a1b1c1' }, { input: 'bbbbbbbbbbbb', output: 'b12' }, { input: 'aabbaa', output: 'a2b2a2' }],
    templates: {
      js: {
        code: `/**
 * Compresses runs of equal characters: "aaabcc" -> "a3b1c2".
 * @param {string} s
 * @return {string}
 */
function compress(s) {
  // Write your code here

}
`,
        driver: `const s = readLine().trim();
console.log(compress(s));`,
      },
      py: {
        code: `class Solution:
    def compress(self, s: str) -> str:
        # Write your code here
        pass
`,
        driver: `import sys

s = sys.stdin.readline().strip()
print(Solution().compress(s))`,
      },
    },
  },
  {
    id: 'C3', section: 'coding', type: 'coding',
    text: {
      en: {
        title: 'Balanced Brackets',
        statement: 'Given a string of brackets ( ) [ ] { }, print YES if every bracket is closed by the same type in the correct order, otherwise print NO.',
        input: 'A single line containing the string s (1 ≤ |s| ≤ 10^5).',
        output: 'YES or NO.',
      },
      hi: {
        title: 'संतुलित कोष्ठक',
        statement: 'कोष्ठकों ( ) [ ] { } की एक स्ट्रिंग दी गई है। यदि हर कोष्ठक उसी प्रकार के कोष्ठक से सही क्रम में बंद होता है तो YES, अन्यथा NO प्रिंट कीजिए।',
        input: 'एक पंक्ति जिसमें स्ट्रिंग s (1 ≤ |s| ≤ 10^5) है।',
        output: 'YES या NO।',
      },
    },
    samples: [{ input: '{[()]}', output: 'YES' }, { input: '([)]', output: 'NO' }],
    hidden: [{ input: '(', output: 'NO' }, { input: '()[]{}', output: 'YES' }, { input: '((()))]', output: 'NO' }, { input: '}{', output: 'NO' }],
    templates: {
      js: {
        code: `/**
 * Returns true when every bracket is closed in the right order.
 * @param {string} s
 * @return {boolean}
 */
function isBalanced(s) {
  // Write your code here

}
`,
        driver: `const s = readLine().trim();
console.log(isBalanced(s) ? 'YES' : 'NO');`,
      },
      py: {
        code: `class Solution:
    def isBalanced(self, s: str) -> bool:
        # Write your code here
        pass
`,
        driver: `import sys

s = sys.stdin.readline().strip()
print("YES" if Solution().isBalanced(s) else "NO")`,
      },
    },
  },
]

export interface RosterEntry { id: string; name: string; dob: string; path: string; centre: string }

// dob is the login password (DDMMYYYY), as on most Indian exam portals.
export const ROSTER: RosterEntry[] = [
  { id: 'EXM-20841', name: 'Kavya Sharma', dob: '14082004', path: 'sync-a', centre: 'Pune-02' },
  { id: 'EXM-20854', name: 'Rohan Patel', dob: '02112003', path: 'sync-a', centre: 'Pune-02' },
  { id: 'EXM-20861', name: 'Aisha Verma', dob: '21052004', path: 'sync-a', centre: 'Pune-02' },
  { id: 'EXM-20866', name: 'Sana Khan', dob: '09012004', path: 'sync-a', centre: 'Pune-02' },
  { id: 'EXM-20870', name: 'Arjun Nair', dob: '30032003', path: 'sync-a', centre: 'Pune-02' },
  { id: 'EXM-20873', name: 'Nikhil Rao', dob: '17072004', path: 'sync-b', centre: 'Mumbai-07' },
  { id: 'EXM-20879', name: 'Meera Iyer', dob: '11122003', path: 'sync-b', centre: 'Mumbai-07' },
  { id: 'EXM-20882', name: 'Farhan Ali', dob: '25062004', path: 'sync-b', centre: 'Mumbai-07' },
  { id: 'EXM-20888', name: 'Priya Das', dob: '04042004', path: 'sync-b', centre: 'Mumbai-07' },
  { id: 'EXM-20891', name: 'Karan Mehta', dob: '19092003', path: 'sync-c', centre: 'Delhi-11' },
  { id: 'EXM-20895', name: 'Ananya Ghosh', dob: '08022004', path: 'sync-c', centre: 'Delhi-11' },
  { id: 'EXM-20899', name: 'Vikram Singh', dob: '27102003', path: 'sync-c', centre: 'Delhi-11' },
]

export const rosterEntry = (id?: string) => ROSTER.find((entry) => entry.id === id)
export const questionById = (id: string) => QUESTIONS.find((question) => question.id === id) ?? QUESTIONS[0]
