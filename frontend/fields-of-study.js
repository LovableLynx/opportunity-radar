// Common fields of study, used to populate the fieldOfStudy <datalist> so
// typing "Business Admin" suggests the correctly spelled option instead of
// letting a typo like "Business Administartion" go straight into every
// listing's scrapedFor record unnoticed. Unlike country (a closed, strict
// <select>), this stays a free-text input with suggestions: fields of study
// are far more numerous and varied than countries, and a student in a field
// not listed here must still be able to type their own, exactly as
// spelled, without being blocked.
//
// Deliberately wide, not just one entry per broad subject: a student
// searching for "Data Science" or "Software Engineering" shouldn't have to
// know to type "Computer Science" instead, since those are real, distinct
// majors at most universities, not synonyms for it. Same reasoning applies
// to Business, Engineering, and Health Sciences below, each broken into the
// specific sub-fields students actually declare as their major.
const FIELDS_OF_STUDY = [
  // Computing & technology
  'Computer Science', 'Software Engineering', 'Software Development',
  'Data Science', 'Information Technology', 'Information Systems',
  'Cybersecurity', 'Artificial Intelligence', 'Machine Learning',
  'Computer Engineering', 'Game Development', 'Web Development',
  'Network Engineering', 'Robotics',

  // Business & management
  'Business Administration', 'Accounting', 'Finance', 'Marketing',
  'Economics', 'International Business', 'Human Resource Management',
  'Supply Chain Management', 'Entrepreneurship', 'Business Analytics',
  'Actuarial Science', 'Hospitality Management', 'Public Administration',

  // Engineering
  'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering',
  'Chemical Engineering', 'Biomedical Engineering', 'Industrial Engineering',
  'Petroleum Engineering', 'Aerospace Engineering', 'Environmental Engineering',
  'Materials Engineering', 'Mechatronics Engineering', 'Agricultural Engineering',

  // Health & medicine
  'Medicine', 'Nursing', 'Pharmacy', 'Dentistry', 'Public Health',
  'Physiotherapy', 'Nutrition and Dietetics', 'Veterinary Medicine',
  'Medical Laboratory Science', 'Radiography', 'Optometry',
  'Biomedical Science', 'Occupational Therapy',

  // Natural & physical sciences
  'Biology', 'Chemistry', 'Physics', 'Mathematics', 'Statistics',
  'Biochemistry', 'Microbiology', 'Zoology', 'Botany', 'Geology',
  'Environmental Science', 'Marine Science', 'Astronomy',
  'Agricultural Science', 'Food Science',

  // Social sciences & humanities
  'Psychology', 'Sociology', 'Political Science', 'International Relations',
  'Anthropology', 'History', 'Philosophy', 'Linguistics', 'Geography',
  'Criminology', 'Social Work', 'Theology', 'Islamic Studies', 'Archaeology',
  'Library and Information Science',

  // Law
  'Law', 'International Law',

  // Education
  'Education', 'Early Childhood Education', 'Special Education',
  'Curriculum Studies', 'Educational Technology', 'Adult Education',

  // Arts, media & design
  'Fine Arts', 'Graphic Design', 'Fashion Design', 'Textile Design',
  'Textile Technology', 'Interior Design', 'Architecture', 'Music',
  'Theatre Arts', 'Film Studies', 'Journalism', 'Mass Communication',
  'Communications', 'Photography', 'Animation',

  // Agriculture, environment & built environment
  'Urban Planning', 'Forestry', 'Fisheries and Aquaculture',
  'Real Estate', 'Estate Management', 'Surveying and Geoinformatics',
  'Quantity Surveying',

  // Maritime, aviation & logistics
  'Maritime Studies', 'Shipping and Logistics', 'Aviation Studies',
  'Aeronautical Engineering', 'Transport and Logistics Management',

  // Sport & recreation
  'Sports Science', 'Physical Education',
];
