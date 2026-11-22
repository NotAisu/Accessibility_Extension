const listItems = chemists.map(person =>
  <li>
     <img
       src={getImageUrl(person)}
      
     />
     <p>
       <b>{person.name}:</b>
       {' ' + person.profession + ' '}
       known for {person.accomplishment}
     </p>
  </li>
);
